import { v4 as uuidv4 } from 'uuid';
import type {
  ChatMessage,
  ChatResponse,
  ChatChoice,
  LLMProvider,
  ProviderAdapter,
  ProviderConfig,
  ProviderRequest,
  UsageInfo,
} from '../types/index.js';
import { ProviderError, ModelNotSupportedError } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

// ============================================================================
// Base Provider Adapter
// ============================================================================

export abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract readonly name: LLMProvider;
  abstract readonly supportedModels: string[];
  
  protected logger = createLogger('provider');

  /**
   * Execute a chat completion request
   */
  abstract chat(request: ProviderRequest, config: ProviderConfig): Promise<ChatResponse>;

  /**
   * Validate if a model is supported by this provider
   */
  validateModel(model: string): boolean {
    // Check exact match or pattern match (for models with versions like gpt-4-0125-preview)
    return this.supportedModels.some(
      (supported) =>
        supported === model ||
        model.startsWith(supported) ||
        supported.includes('*') && new RegExp(supported.replace('*', '.*')).test(model)
    );
  }

  /**
   * Map model name to provider-specific format
   * Override in subclasses if needed
   */
  mapModelName(model: string): string {
    return model;
  }

  /**
   * Create a standardized response
   */
  protected createResponse(
    model: string,
    content: string,
    usage?: UsageInfo,
    finishReason: ChatChoice['finishReason'] = 'stop',
  ): ChatResponse {
    return {
      id: uuidv4(),
      provider: this.name,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finishReason,
        },
      ],
      usage,
      created: Date.now(),
    };
  }

  /**
   * Handle provider errors uniformly
   */
  protected handleError(error: unknown, model: string): never {
    this.logger.error({ provider: this.name, model, error }, 'Provider request failed');

    if (error instanceof ProviderError) {
      throw error;
    }

    if (error instanceof Error) {
      // Check for common error patterns
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        throw new ProviderError(this.name, 'Rate limit exceeded', 429);
      }
      if (error.message.includes('unauthorized') || error.message.includes('401')) {
        throw new ProviderError(this.name, 'Invalid API key', 401);
      }
      if (error.message.includes('not found') || error.message.includes('404')) {
        throw new ModelNotSupportedError(model, this.name);
      }
      throw new ProviderError(this.name, error.message);
    }

    throw new ProviderError(this.name, 'Unknown error occurred');
  }
}

// ============================================================================
// OpenAI-Compatible Base Adapter
// ============================================================================

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string;
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Base adapter for OpenAI-compatible APIs
 * Works with OpenAI, Groq, Together, Fireworks, DeepSeek, etc.
 */
export abstract class OpenAICompatibleAdapter extends BaseProviderAdapter {
  abstract readonly baseUrl: string;

  async chat(request: ProviderRequest, config: ProviderConfig): Promise<ChatResponse> {
    const mappedModel = this.mapModelName(request.model);
    const baseUrl = config.baseUrl || this.baseUrl;

    try {
      const openaiRequest: OpenAIRequest = {
        model: mappedModel,
        messages: request.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          ...(msg.name && { name: msg.name }),
        })),
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        ...(request.maxTokens !== undefined && { max_tokens: request.maxTokens }),
        ...(request.topP !== undefined && { top_p: request.topP }),
        stream: false, // We'll handle streaming separately
      };

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(openaiRequest),
        signal: AbortSignal.timeout(config.timeout || 60000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(
          this.name,
          `HTTP ${response.status}: ${errorText}`,
          response.status,
        );
      }

      const data = (await response.json()) as OpenAIResponse;

      const firstChoice = data.choices[0];
      if (!firstChoice) {
        throw new ProviderError(this.name, 'No choices in response');
      }

      return {
        id: data.id,
        provider: this.name,
        model: data.model,
        choices: data.choices.map((choice) => ({
          index: choice.index,
          message: {
            role: choice.message.role as ChatMessage['role'],
            content: choice.message.content,
          },
          finishReason: this.mapFinishReason(choice.finish_reason),
        })),
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
        created: data.created * 1000, // Convert to milliseconds
      };
    } catch (error) {
      return this.handleError(error, request.model);
    }
  }

  protected mapFinishReason(reason: string): ChatChoice['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      case 'function_call':
      case 'tool_calls':
        return 'function_call';
      default:
        return null;
    }
  }
}

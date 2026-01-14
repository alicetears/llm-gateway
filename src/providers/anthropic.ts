import { BaseProviderAdapter } from './base.js';
import type {
  ChatResponse,
  LLMProvider,
  ProviderConfig,
  ProviderRequest,
} from '../types/index.js';
import { ProviderError } from '../types/index.js';
import { providerConfigs } from '../config/index.js';

// ============================================================================
// Anthropic API Types
// ============================================================================

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ============================================================================
// Anthropic Provider Adapter
// ============================================================================

export class AnthropicAdapter extends BaseProviderAdapter {
  readonly name: LLMProvider = 'anthropic';
  readonly baseUrl = providerConfigs.anthropic.baseUrl;

  readonly supportedModels: string[] = [
    // Claude 3.5
    'claude-3-5-sonnet-20241022',
    'claude-3-5-sonnet-20240620',
    'claude-3-5-haiku-20241022',
    // Claude 3
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
    // Aliases
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
    'claude-3-opus-latest',
  ];

  async chat(request: ProviderRequest, config: ProviderConfig): Promise<ChatResponse> {
    const mappedModel = this.mapModelName(request.model);
    const baseUrl = config.baseUrl || this.baseUrl;

    try {
      // Extract system message if present
      let systemMessage: string | undefined;
      const messages: AnthropicMessage[] = [];

      for (const msg of request.messages) {
        if (msg.role === 'system') {
          systemMessage = msg.content;
        } else {
          messages.push({
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
          });
        }
      }

      const anthropicRequest: AnthropicRequest = {
        model: mappedModel,
        messages,
        max_tokens: request.maxTokens || 4096,
        ...(systemMessage && { system: systemMessage }),
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        ...(request.topP !== undefined && { top_p: request.topP }),
      };

      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicRequest),
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

      const data = (await response.json()) as AnthropicResponse;

      const content = data.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return {
        id: data.id,
        provider: this.name,
        model: data.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finishReason: this.mapStopReason(data.stop_reason),
          },
        ],
        usage: {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        },
        created: Date.now(),
      };
    } catch (error) {
      return this.handleError(error, request.model);
    }
  }

  private mapStopReason(reason: string | null): 'stop' | 'length' | null {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      default:
        return null;
    }
  }

  override mapModelName(model: string): string {
    // Map short names to full model names
    const modelMap: Record<string, string> = {
      'claude-3.5-sonnet': 'claude-3-5-sonnet-20241022',
      'claude-3.5-haiku': 'claude-3-5-haiku-20241022',
      'claude-3-opus': 'claude-3-opus-20240229',
      'claude-3-sonnet': 'claude-3-sonnet-20240229',
      'claude-3-haiku': 'claude-3-haiku-20240307',
    };
    return modelMap[model] || model;
  }
}

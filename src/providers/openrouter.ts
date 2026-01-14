import { OpenAICompatibleAdapter, type OpenAIResponse } from './base.js';
import type { LLMProvider, ProviderConfig, ProviderRequest, ChatResponse, ChatMessage } from '../types/index.js';
import { ProviderError } from '../types/index.js';
import { providerConfigs } from '../config/index.js';

// ============================================================================
// OpenRouter Provider Adapter
// ============================================================================

export class OpenRouterAdapter extends OpenAICompatibleAdapter {
  readonly name: LLMProvider = 'openrouter';
  readonly baseUrl = providerConfigs.openrouter.baseUrl;

  // OpenRouter supports many models - this is a subset
  readonly supportedModels: string[] = [
    // OpenAI models via OpenRouter
    'openai/gpt-4-turbo',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'openai/gpt-3.5-turbo',
    'openai/o1-preview',
    'openai/o1-mini',
    // Anthropic models via OpenRouter
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3.5-haiku',
    'anthropic/claude-3-opus',
    'anthropic/claude-3-sonnet',
    'anthropic/claude-3-haiku',
    // Google models via OpenRouter
    'google/gemini-pro',
    'google/gemini-pro-1.5',
    'google/gemini-flash-1.5',
    // Meta models via OpenRouter
    'meta-llama/llama-3.1-405b-instruct',
    'meta-llama/llama-3.1-70b-instruct',
    'meta-llama/llama-3.1-8b-instruct',
    // Mistral models via OpenRouter
    'mistralai/mistral-large',
    'mistralai/mistral-medium',
    'mistralai/mixtral-8x7b-instruct',
    // Other popular models
    'deepseek/deepseek-chat',
    'qwen/qwen-2.5-72b-instruct',
  ];

  override async chat(request: ProviderRequest, config: ProviderConfig): Promise<ChatResponse> {
    const mappedModel = this.mapModelName(request.model);
    const baseUrl = config.baseUrl || this.baseUrl;

    try {
      const openrouterRequest = {
        model: mappedModel,
        messages: request.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          ...(msg.name && { name: msg.name }),
        })),
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        ...(request.maxTokens !== undefined && { max_tokens: request.maxTokens }),
        ...(request.topP !== undefined && { top_p: request.topP }),
        stream: false,
      };

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          'HTTP-Referer': 'https://llm-gateway.local',
          'X-Title': 'LLM Gateway',
        },
        body: JSON.stringify(openrouterRequest),
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
      
      const firstChoice = data.choices?.[0];
      if (!firstChoice) {
        throw new ProviderError(this.name, 'No choices in response');
      }

      return {
        id: data.id,
        provider: this.name,
        model: data.model || mappedModel,
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
        created: data.created ? data.created * 1000 : Date.now(),
      };
    } catch (error) {
      return this.handleError(error, request.model);
    }
  }

  override validateModel(_model: string): boolean {
    // OpenRouter accepts most models, be permissive
    return true;
  }
}

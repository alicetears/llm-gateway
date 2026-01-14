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
// Gemini API Types
// ============================================================================

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// ============================================================================
// Gemini Provider Adapter
// ============================================================================

export class GeminiAdapter extends BaseProviderAdapter {
  readonly name: LLMProvider = 'gemini';
  readonly baseUrl = providerConfigs.gemini.baseUrl;

  readonly supportedModels: string[] = [
    'gemini-1.5-pro',
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-8b',
    'gemini-1.0-pro',
    'gemini-pro',
    'gemini-2.0-flash-exp',
  ];

  async chat(request: ProviderRequest, config: ProviderConfig): Promise<ChatResponse> {
    const mappedModel = this.mapModelName(request.model);
    const baseUrl = config.baseUrl || this.baseUrl;

    try {
      // Convert messages to Gemini format
      let systemInstruction: { parts: Array<{ text: string }> } | undefined;
      const contents: GeminiContent[] = [];

      for (const msg of request.messages) {
        if (msg.role === 'system') {
          systemInstruction = { parts: [{ text: msg.content }] };
        } else {
          contents.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }],
          });
        }
      }

      const geminiRequest: GeminiRequest = {
        contents,
        ...(systemInstruction && { systemInstruction }),
        generationConfig: {
          ...(request.temperature !== undefined && { temperature: request.temperature }),
          ...(request.topP !== undefined && { topP: request.topP }),
          ...(request.maxTokens !== undefined && { maxOutputTokens: request.maxTokens }),
        },
      };

      const url = `${baseUrl}/models/${mappedModel}:generateContent?key=${config.apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiRequest),
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

      const data = (await response.json()) as GeminiResponse;

      const firstCandidate = data.candidates?.[0];
      if (!firstCandidate) {
        throw new ProviderError(this.name, 'No candidates in response');
      }

      const content = firstCandidate.content.parts
        .map((part) => part.text)
        .join('');

      return {
        id: `gemini-${Date.now()}`,
        provider: this.name,
        model: mappedModel,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finishReason: this.mapFinishReason(firstCandidate.finishReason),
          },
        ],
        usage: data.usageMetadata
          ? {
              promptTokens: data.usageMetadata.promptTokenCount,
              completionTokens: data.usageMetadata.candidatesTokenCount,
              totalTokens: data.usageMetadata.totalTokenCount,
            }
          : undefined,
        created: Date.now(),
      };
    } catch (error) {
      return this.handleError(error, request.model);
    }
  }

  private mapFinishReason(reason: string): 'stop' | 'length' | 'content_filter' | null {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
        return 'content_filter';
      default:
        return null;
    }
  }

  override mapModelName(model: string): string {
    // Map short names
    const modelMap: Record<string, string> = {
      'gemini-pro': 'gemini-1.0-pro',
    };
    return modelMap[model] || model;
  }
}

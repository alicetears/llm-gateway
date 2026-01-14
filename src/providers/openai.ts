import { OpenAICompatibleAdapter } from './base.js';
import type { LLMProvider } from '../types/index.js';
import { providerConfigs } from '../config/index.js';

// ============================================================================
// OpenAI Provider Adapter
// ============================================================================

export class OpenAIAdapter extends OpenAICompatibleAdapter {
  readonly name: LLMProvider = 'openai';
  readonly baseUrl = providerConfigs.openai.baseUrl;

  readonly supportedModels: string[] = [
    // GPT-4 Turbo
    'gpt-4-turbo',
    'gpt-4-turbo-preview',
    'gpt-4-turbo-2024-04-09',
    'gpt-4-0125-preview',
    'gpt-4-1106-preview',
    // GPT-4
    'gpt-4',
    'gpt-4-0613',
    'gpt-4-32k',
    'gpt-4-32k-0613',
    // GPT-4o
    'gpt-4o',
    'gpt-4o-2024-05-13',
    'gpt-4o-2024-08-06',
    'gpt-4o-2024-11-20',
    'gpt-4o-mini',
    'gpt-4o-mini-2024-07-18',
    // o1 models
    'o1-preview',
    'o1-preview-2024-09-12',
    'o1-mini',
    'o1-mini-2024-09-12',
    'o1',
    'o1-2024-12-17',
    // GPT-3.5
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-0125',
    'gpt-3.5-turbo-1106',
    'gpt-3.5-turbo-16k',
  ];

  override validateModel(model: string): boolean {
    // OpenAI model names can have date suffixes
    return this.supportedModels.some(
      (supported) => model === supported || model.startsWith(supported.split('-')[0] || '')
    );
  }
}

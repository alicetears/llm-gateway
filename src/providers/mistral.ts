import { OpenAICompatibleAdapter } from './base.js';
import type { LLMProvider } from '../types/index.js';
import { providerConfigs } from '../config/index.js';

// ============================================================================
// Mistral Provider Adapter
// ============================================================================

export class MistralAdapter extends OpenAICompatibleAdapter {
  readonly name: LLMProvider = 'mistral';
  readonly baseUrl = providerConfigs.mistral.baseUrl;

  readonly supportedModels: string[] = [
    // Latest models
    'mistral-large-latest',
    'mistral-large-2411',
    'mistral-medium-latest',
    'mistral-small-latest',
    'mistral-small-2409',
    // Specific versions
    'mistral-large-2407',
    'mistral-medium-2312',
    // Open models
    'open-mistral-7b',
    'open-mixtral-8x7b',
    'open-mixtral-8x22b',
    // Specialized
    'codestral-latest',
    'codestral-2405',
    'mistral-embed',
    // Pixtral (multimodal)
    'pixtral-12b-2409',
    'pixtral-large-latest',
  ];

  override mapModelName(model: string): string {
    // Map common aliases
    const modelMap: Record<string, string> = {
      'mistral-large': 'mistral-large-latest',
      'mistral-medium': 'mistral-medium-latest',
      'mistral-small': 'mistral-small-latest',
      'mixtral-8x7b': 'open-mixtral-8x7b',
      'mixtral-8x22b': 'open-mixtral-8x22b',
      'codestral': 'codestral-latest',
    };
    return modelMap[model] || model;
  }
}

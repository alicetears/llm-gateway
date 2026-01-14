import { OpenAICompatibleAdapter } from './base.js';
import type { LLMProvider } from '../types/index.js';
import { providerConfigs } from '../config/index.js';

// ============================================================================
// DeepSeek Provider Adapter
// ============================================================================

export class DeepSeekAdapter extends OpenAICompatibleAdapter {
  readonly name: LLMProvider = 'deepseek';
  readonly baseUrl = providerConfigs.deepseek.baseUrl;

  readonly supportedModels: string[] = [
    'deepseek-chat',
    'deepseek-coder',
    'deepseek-reasoner',
  ];

  override mapModelName(model: string): string {
    // Map common aliases
    const modelMap: Record<string, string> = {
      'deepseek': 'deepseek-chat',
      'deepseek-v3': 'deepseek-chat',
      'deepseek-code': 'deepseek-coder',
      'deepseek-r1': 'deepseek-reasoner',
    };
    return modelMap[model] || model;
  }
}

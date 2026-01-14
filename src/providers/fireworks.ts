import { OpenAICompatibleAdapter } from './base.js';
import type { LLMProvider } from '../types/index.js';
import { providerConfigs } from '../config/index.js';

// ============================================================================
// Fireworks AI Provider Adapter
// ============================================================================

export class FireworksAdapter extends OpenAICompatibleAdapter {
  readonly name: LLMProvider = 'fireworks';
  readonly baseUrl = providerConfigs.fireworks.baseUrl;

  readonly supportedModels: string[] = [
    // Meta LLaMA
    'accounts/fireworks/models/llama-v3p1-405b-instruct',
    'accounts/fireworks/models/llama-v3p1-70b-instruct',
    'accounts/fireworks/models/llama-v3p1-8b-instruct',
    'accounts/fireworks/models/llama-v3p2-90b-vision-instruct',
    'accounts/fireworks/models/llama-v3p2-11b-vision-instruct',
    'accounts/fireworks/models/llama-v3p2-3b-instruct',
    'accounts/fireworks/models/llama-v3p2-1b-instruct',
    // Mixtral
    'accounts/fireworks/models/mixtral-8x22b-instruct',
    'accounts/fireworks/models/mixtral-8x7b-instruct',
    // Qwen
    'accounts/fireworks/models/qwen2p5-72b-instruct',
    'accounts/fireworks/models/qwen2p5-coder-32b-instruct',
    // DeepSeek
    'accounts/fireworks/models/deepseek-v3',
    'accounts/fireworks/models/deepseek-coder-v2-instruct',
    // Firefunction (function calling optimized)
    'accounts/fireworks/models/firefunction-v2',
    // FireLLaVA (vision)
    'accounts/fireworks/models/firellava-13b',
  ];

  override mapModelName(model: string): string {
    // Map short names to full model paths
    const modelMap: Record<string, string> = {
      'llama-3.1-405b': 'accounts/fireworks/models/llama-v3p1-405b-instruct',
      'llama-3.1-70b': 'accounts/fireworks/models/llama-v3p1-70b-instruct',
      'llama-3.1-8b': 'accounts/fireworks/models/llama-v3p1-8b-instruct',
      'mixtral-8x22b': 'accounts/fireworks/models/mixtral-8x22b-instruct',
      'mixtral-8x7b': 'accounts/fireworks/models/mixtral-8x7b-instruct',
      'qwen-72b': 'accounts/fireworks/models/qwen2p5-72b-instruct',
      'deepseek-v3': 'accounts/fireworks/models/deepseek-v3',
      'firefunction': 'accounts/fireworks/models/firefunction-v2',
    };
    return modelMap[model] || model;
  }

  override validateModel(model: string): boolean {
    // Fireworks uses accounts/fireworks/models/ prefix
    return (
      model.startsWith('accounts/') ||
      this.supportedModels.some((supported) =>
        supported.toLowerCase().includes(model.toLowerCase())
      )
    );
  }
}

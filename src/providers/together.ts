import { OpenAICompatibleAdapter } from './base.js';
import type { LLMProvider } from '../types/index.js';
import { providerConfigs } from '../config/index.js';

// ============================================================================
// Together AI Provider Adapter
// ============================================================================

export class TogetherAdapter extends OpenAICompatibleAdapter {
  readonly name: LLMProvider = 'together';
  readonly baseUrl = providerConfigs.together.baseUrl;

  readonly supportedModels: string[] = [
    // Meta LLaMA
    'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
    'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
    'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
    'meta-llama/Llama-3.2-3B-Instruct-Turbo',
    // Mistral
    'mistralai/Mixtral-8x22B-Instruct-v0.1',
    'mistralai/Mixtral-8x7B-Instruct-v0.1',
    'mistralai/Mistral-7B-Instruct-v0.3',
    // Qwen
    'Qwen/Qwen2.5-72B-Instruct-Turbo',
    'Qwen/Qwen2.5-7B-Instruct-Turbo',
    'Qwen/QwQ-32B-Preview',
    // DeepSeek
    'deepseek-ai/DeepSeek-V3',
    'deepseek-ai/deepseek-llm-67b-chat',
    // Google
    'google/gemma-2-27b-it',
    'google/gemma-2-9b-it',
    // WizardLM
    'WizardLM/WizardLM-2-8x22B',
    // Databricks
    'databricks/dbrx-instruct',
  ];

  override mapModelName(model: string): string {
    // Map short names to full model paths
    const modelMap: Record<string, string> = {
      'llama-3.1-405b': 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
      'llama-3.1-70b': 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
      'llama-3.1-8b': 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
      'mixtral-8x22b': 'mistralai/Mixtral-8x22B-Instruct-v0.1',
      'mixtral-8x7b': 'mistralai/Mixtral-8x7B-Instruct-v0.1',
      'qwen-72b': 'Qwen/Qwen2.5-72B-Instruct-Turbo',
      'deepseek-v3': 'deepseek-ai/DeepSeek-V3',
    };
    return modelMap[model] || model;
  }

  override validateModel(model: string): boolean {
    // Together supports many models, be more permissive
    return this.supportedModels.some(
      (supported) =>
        model === supported ||
        supported.toLowerCase().includes(model.toLowerCase())
    );
  }
}

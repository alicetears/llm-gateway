import { OpenAICompatibleAdapter } from './base.js';
import type { LLMProvider } from '../types/index.js';
import { providerConfigs } from '../config/index.js';

// ============================================================================
// Groq Provider Adapter
// ============================================================================

export class GroqAdapter extends OpenAICompatibleAdapter {
  readonly name: LLMProvider = 'groq';
  readonly baseUrl = providerConfigs.groq.baseUrl;

  readonly supportedModels: string[] = [
    // LLaMA models
    'llama-3.3-70b-versatile',
    'llama-3.2-90b-vision-preview',
    'llama-3.2-11b-vision-preview',
    'llama-3.2-3b-preview',
    'llama-3.2-1b-preview',
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'llama3-8b-8192',
    // Mixtral
    'mixtral-8x7b-32768',
    // Gemma
    'gemma2-9b-it',
    'gemma-7b-it',
    // Whisper (for completeness)
    'whisper-large-v3',
    'whisper-large-v3-turbo',
  ];

  override mapModelName(model: string): string {
    // Map common aliases
    const modelMap: Record<string, string> = {
      'llama-3-70b': 'llama3-70b-8192',
      'llama-3-8b': 'llama3-8b-8192',
      'llama-3.1-70b': 'llama-3.1-70b-versatile',
      'llama-3.1-8b': 'llama-3.1-8b-instant',
      'mixtral': 'mixtral-8x7b-32768',
    };
    return modelMap[model] || model;
  }
}

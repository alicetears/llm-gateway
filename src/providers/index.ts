import type { LLMProvider, ProviderAdapter } from '../types/index.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { OpenRouterAdapter } from './openrouter.js';
import { GeminiAdapter } from './gemini.js';
import { MistralAdapter } from './mistral.js';
import { GroqAdapter } from './groq.js';
import { TogetherAdapter } from './together.js';
import { FireworksAdapter } from './fireworks.js';
import { DeepSeekAdapter } from './deepseek.js';

// ============================================================================
// Provider Registry
// ============================================================================

const providerAdapters: Map<LLMProvider, ProviderAdapter> = new Map();

// Initialize all adapters
const adapters: ProviderAdapter[] = [
  new OpenAIAdapter(),
  new AnthropicAdapter(),
  new OpenRouterAdapter(),
  new GeminiAdapter(),
  new MistralAdapter(),
  new GroqAdapter(),
  new TogetherAdapter(),
  new FireworksAdapter(),
  new DeepSeekAdapter(),
];

for (const adapter of adapters) {
  providerAdapters.set(adapter.name, adapter);
}

// ============================================================================
// Provider Access Functions
// ============================================================================

/**
 * Get a specific provider adapter
 */
export function getProviderAdapter(provider: LLMProvider): ProviderAdapter | undefined {
  return providerAdapters.get(provider);
}

/**
 * Get all available providers
 */
export function getAllProviders(): LLMProvider[] {
  return Array.from(providerAdapters.keys());
}

/**
 * Check if a provider is supported
 */
export function isProviderSupported(provider: string): provider is LLMProvider {
  return providerAdapters.has(provider as LLMProvider);
}

/**
 * Find providers that support a given model
 */
export function findProvidersForModel(model: string): LLMProvider[] {
  const supportingProviders: LLMProvider[] = [];
  
  for (const [provider, adapter] of providerAdapters) {
    if (adapter.validateModel(model)) {
      supportingProviders.push(provider);
    }
  }
  
  return supportingProviders;
}

// ============================================================================
// Re-exports
// ============================================================================

export { OpenAIAdapter } from './openai.js';
export { AnthropicAdapter } from './anthropic.js';
export { OpenRouterAdapter } from './openrouter.js';
export { GeminiAdapter } from './gemini.js';
export { MistralAdapter } from './mistral.js';
export { GroqAdapter } from './groq.js';
export { TogetherAdapter } from './together.js';
export { FireworksAdapter } from './fireworks.js';
export { DeepSeekAdapter } from './deepseek.js';
export { BaseProviderAdapter, OpenAICompatibleAdapter } from './base.js';

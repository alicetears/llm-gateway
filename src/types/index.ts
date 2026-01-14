import { z } from 'zod';

// ============================================================================
// Provider Types
// ============================================================================

export const ProviderEnum = z.enum([
  'auto',
  'openrouter',
  'openai',
  'anthropic',
  'gemini',
  'mistral',
  'groq',
  'together',
  'fireworks',
  'deepseek',
]);

export type Provider = z.infer<typeof ProviderEnum>;
export type LLMProvider = Exclude<Provider, 'auto'>;

// ============================================================================
// Chat Message Types
// ============================================================================

export const MessageRoleEnum = z.enum(['system', 'user', 'assistant']);
export type MessageRole = z.infer<typeof MessageRoleEnum>;

export const ChatMessageSchema = z.object({
  role: MessageRoleEnum,
  content: z.string(),
  name: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ============================================================================
// Chat Request Schema
// ============================================================================

export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  model: z.string().optional(),
  provider: ProviderEnum.default('auto'),
  allowedProviders: z.array(z.string()).nullable().optional(),
  allowedPriorities: z.array(z.number()).nullable().optional(),
  
  // Optional parameters
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional().default(false),
  
  // Request metadata
  requestId: z.string().optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// ============================================================================
// Chat Response Types
// ============================================================================

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finishReason: 'stop' | 'length' | 'content_filter' | 'function_call' | null;
}

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  id: string;
  provider: LLMProvider;
  model: string;
  choices: ChatChoice[];
  usage?: UsageInfo;
  created: number;
}

// ============================================================================
// API Key Types
// ============================================================================

export interface ApiKeyInfo {
  id: string;
  provider: LLMProvider;
  apiKey: string;
  name?: string | null;
  priority: number;
  enabled: boolean;
  allowedModels: string[];
  defaultModel: string;
  dailyLimit: number | null;
  usedToday: number;
  resetDate: Date;
}

export interface KeySelectionResult {
  key: ApiKeyInfo;
  resolvedModel: string;
}

// ============================================================================
// Provider Adapter Types
// ============================================================================

export interface ProviderConfig {
  baseUrl?: string;
  apiKey: string;
  timeout?: number;
}

export interface ProviderRequest {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
}

export interface ProviderAdapter {
  readonly name: LLMProvider;
  readonly supportedModels: string[];
  
  chat(request: ProviderRequest, config: ProviderConfig): Promise<ChatResponse>;
  validateModel(model: string): boolean;
  mapModelName(model: string): string;
}

// ============================================================================
// Router Types
// ============================================================================

export type KeySelectionStrategy = 'exhaust-first' | 'round-robin';

export interface RouterConfig {
  strategy: KeySelectionStrategy;
  maxRetries: number;
  retryDelayMs: number;
}

export interface RoutingContext {
  requestedModel?: string;
  requestedProvider: Provider;
  allowedProviders?: string[] | null;
  allowedPriorities?: number[] | null;
}

// ============================================================================
// Queue Types
// ============================================================================

export interface QueueJobData {
  requestId: string;
  request: ChatRequest;
  timestamp: number;
}

export interface QueueJobResult {
  success: boolean;
  response?: ChatResponse;
  error?: string;
  keyId?: string;
  provider?: LLMProvider;
  model?: string;
  latencyMs?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class LLMGatewayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'LLMGatewayError';
  }
}

export class NoEligibleKeyError extends LLMGatewayError {
  constructor(model?: string, provider?: string) {
    super(
      `No eligible API key found${model ? ` for model: ${model}` : ''}${provider ? ` with provider: ${provider}` : ''}`,
      'NO_ELIGIBLE_KEY',
      429,
      { model, provider },
    );
    this.name = 'NoEligibleKeyError';
  }
}

export class ProviderError extends LLMGatewayError {
  constructor(
    provider: string,
    message: string,
    statusCode: number = 500,
    details?: Record<string, unknown>,
  ) {
    super(`Provider ${provider} error: ${message}`, 'PROVIDER_ERROR', statusCode, {
      provider,
      ...details,
    });
    this.name = 'ProviderError';
  }
}

export class ModelNotSupportedError extends LLMGatewayError {
  constructor(model: string, provider: string) {
    super(
      `Model ${model} is not supported by provider ${provider}`,
      'MODEL_NOT_SUPPORTED',
      400,
      { model, provider },
    );
    this.name = 'ModelNotSupportedError';
  }
}

export class RateLimitError extends LLMGatewayError {
  constructor(keyId: string, limit: number) {
    super(
      `Daily limit of ${limit} requests exceeded for key`,
      'RATE_LIMIT_EXCEEDED',
      429,
      { keyId, limit },
    );
    this.name = 'RateLimitError';
  }
}

import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ============================================================================
// Configuration Schema
// ============================================================================

const ConfigSchema = z.object({
  // Server
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3000),
  host: z.string().default('0.0.0.0'),

  // Database
  databaseUrl: z.string().url(),

  // Redis
  redisUrl: z.string().default('redis://localhost:6379'),

  // API Configuration
  apiKeyHeader: z.string().default('x-api-key'),
  rateLimitMax: z.coerce.number().default(100),
  rateLimitWindowMs: z.coerce.number().default(60000),

  // Key Selection Strategy
  keySelectionStrategy: z.enum(['exhaust-first', 'round-robin']).default('exhaust-first'),

  // Logging
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Optional settings
  defaultProvider: z.string().default('auto'),
  enableLlmHeaders: z.coerce.boolean().default(true),

  // Retry configuration
  maxRetries: z.coerce.number().default(3),
  retryDelayMs: z.coerce.number().default(1000),

  // Queue configuration
  queueConcurrency: z.coerce.number().default(10),
});

export type Config = z.infer<typeof ConfigSchema>;

// ============================================================================
// Parse and validate configuration
// ============================================================================

function loadConfig(): Config {
  const result = ConfigSchema.safeParse({
    nodeEnv: process.env['NODE_ENV'],
    port: process.env['PORT'],
    host: process.env['HOST'],
    databaseUrl: process.env['DATABASE_URL'],
    redisUrl: process.env['REDIS_URL'],
    apiKeyHeader: process.env['API_KEY_HEADER'],
    rateLimitMax: process.env['RATE_LIMIT_MAX'],
    rateLimitWindowMs: process.env['RATE_LIMIT_WINDOW_MS'],
    keySelectionStrategy: process.env['KEY_SELECTION_STRATEGY'],
    logLevel: process.env['LOG_LEVEL'],
    defaultProvider: process.env['DEFAULT_PROVIDER'],
    enableLlmHeaders: process.env['ENABLE_LLM_HEADERS'],
    maxRetries: process.env['MAX_RETRIES'],
    retryDelayMs: process.env['RETRY_DELAY_MS'],
    queueConcurrency: process.env['QUEUE_CONCURRENCY'],
  });

  if (!result.success) {
    console.error('Configuration validation failed:');
    console.error(result.error.format());
    throw new Error('Invalid configuration');
  }

  return result.data;
}

export const config = loadConfig();

// ============================================================================
// Provider-specific configurations
// ============================================================================

export const providerConfigs = {
  openai: {
    baseUrl: process.env['OPENAI_BASE_URL'] || 'https://api.openai.com/v1',
    timeout: 60000,
  },
  anthropic: {
    baseUrl: process.env['ANTHROPIC_BASE_URL'] || 'https://api.anthropic.com',
    timeout: 60000,
  },
  openrouter: {
    baseUrl: process.env['OPENROUTER_BASE_URL'] || 'https://openrouter.ai/api/v1',
    timeout: 60000,
  },
  gemini: {
    baseUrl: process.env['GEMINI_BASE_URL'] || 'https://generativelanguage.googleapis.com/v1beta',
    timeout: 60000,
  },
  mistral: {
    baseUrl: process.env['MISTRAL_BASE_URL'] || 'https://api.mistral.ai/v1',
    timeout: 60000,
  },
  groq: {
    baseUrl: process.env['GROQ_BASE_URL'] || 'https://api.groq.com/openai/v1',
    timeout: 60000,
  },
  together: {
    baseUrl: process.env['TOGETHER_BASE_URL'] || 'https://api.together.xyz/v1',
    timeout: 60000,
  },
  fireworks: {
    baseUrl: process.env['FIREWORKS_BASE_URL'] || 'https://api.fireworks.ai/inference/v1',
    timeout: 60000,
  },
  deepseek: {
    baseUrl: process.env['DEEPSEEK_BASE_URL'] || 'https://api.deepseek.com/v1',
    timeout: 60000,
  },
} as const;

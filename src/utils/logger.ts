import pino from 'pino';
import { config } from '../config/index.js';

// ============================================================================
// Logger Configuration
// ============================================================================

export const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    service: 'llm-gateway',
    env: config.nodeEnv,
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// ============================================================================
// Child Logger Factory
// ============================================================================

export function createLogger(context: string, meta?: Record<string, unknown>) {
  return logger.child({ context, ...meta });
}

// ============================================================================
// Request Logger Helper
// ============================================================================

export interface RequestLogContext {
  requestId: string;
  provider?: string;
  model?: string;
  keyId?: string;
}

export function logRequest(ctx: RequestLogContext, message: string, extra?: Record<string, unknown>) {
  logger.info({ ...ctx, ...extra }, message);
}

export function logError(ctx: RequestLogContext, error: Error, message?: string) {
  logger.error(
    {
      ...ctx,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    },
    message || error.message,
  );
}

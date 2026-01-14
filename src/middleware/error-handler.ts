import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { LLMGatewayError } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('error-handler');

// ============================================================================
// Error Response Interface
// ============================================================================

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId?: string;
}

// ============================================================================
// Error Handler
// ============================================================================

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const requestId = (request.headers['x-request-id'] as string) || 
                    (request.body as { requestId?: string })?.requestId;

  // Log the error
  logger.error(
    {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      path: request.url,
      method: request.method,
    },
    'Request error',
  );

  // Handle LLM Gateway errors
  if (error instanceof LLMGatewayError) {
    const response: ErrorResponse = {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      requestId,
    };
    reply.status(error.statusCode).send(response);
    return;
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const response: ErrorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: {
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      requestId,
    };
    reply.status(400).send(response);
    return;
  }

  // Handle Fastify errors
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    const response: ErrorResponse = {
      error: {
        code: error.code || 'REQUEST_ERROR',
        message: error.message,
      },
      requestId,
    };
    reply.status(error.statusCode).send(response);
    return;
  }

  // Handle unknown errors
  const response: ErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
    requestId,
  };
  reply.status(500).send(response);
}

// ============================================================================
// Not Found Handler
// ============================================================================

export function notFoundHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const response: ErrorResponse = {
    error: {
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
    },
  };
  reply.status(404).send(response);
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ChatRequestSchema, type ChatRequest } from '../types/index.js';
import { getRouter } from '../services/router.js';
import { enqueueChatRequest, waitForJob, getQueueStats } from '../queue/jobs.js';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('chat-route');

// ============================================================================
// Route Types
// ============================================================================

interface ChatRequestBody {
  messages: Array<{ role: string; content: string; name?: string }>;
  model?: string;
  provider?: string;
  allowedProviders?: string[] | null;
  allowedPriorities?: number[] | null;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  requestId?: string;
  async?: boolean;
}

interface ChatResponseBody {
  id: string;
  provider: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finishReason: string | null;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  created: number;
}

interface AsyncChatResponse {
  requestId: string;
  status: 'queued';
  message: string;
}

// ============================================================================
// Chat Routes Plugin
// ============================================================================

export async function chatRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/chat - Main chat completion endpoint
   */
  fastify.post<{
    Body: ChatRequestBody;
    Reply: ChatResponseBody | AsyncChatResponse;
  }>(
    '/chat',
    async (request: FastifyRequest<{ Body: ChatRequestBody }>, reply: FastifyReply) => {
      const requestId = request.body.requestId || uuidv4();
      
      // Validate request body
      const validatedBody = ChatRequestSchema.parse({
        ...request.body,
        requestId,
      });

      logger.info(
        {
          requestId,
          model: validatedBody.model,
          provider: validatedBody.provider,
          messageCount: validatedBody.messages.length,
          async: request.body.async,
        },
        'Chat request received',
      );

      // Handle async requests
      if (request.body.async) {
        await enqueueChatRequest(validatedBody);
        
        reply.status(202);
        return {
          requestId,
          status: 'queued' as const,
          message: 'Request queued for processing',
        };
      }

      // Synchronous processing
      const router = getRouter();
      const { response, metadata } = await router.route(validatedBody);

      // Add optional LLM headers
      if (config.enableLlmHeaders) {
        reply.header('X-LLM-Provider', metadata.provider);
        reply.header('X-LLM-Model', metadata.model);
        reply.header('X-LLM-Key-ID', metadata.keyId);
        reply.header('X-LLM-Latency-Ms', metadata.latencyMs.toString());
      }

      return {
        id: response.id,
        provider: response.provider,
        model: response.model,
        choices: response.choices.map((choice) => ({
          index: choice.index,
          message: {
            role: choice.message.role,
            content: choice.message.content,
          },
          finishReason: choice.finishReason,
        })),
        usage: response.usage,
        created: response.created,
      };
    },
  );

  /**
   * GET /api/chat/:requestId - Get async request result
   */
  fastify.get<{
    Params: { requestId: string };
    Querystring: { timeout?: string };
  }>(
    '/chat/:requestId',
    async (request, reply) => {
      const { requestId } = request.params;
      const timeout = parseInt(request.query.timeout || '30000', 10);

      logger.info({ requestId, timeout }, 'Fetching async request result');

      try {
        const result = await waitForJob(requestId, timeout);

        if (!result.success) {
          reply.status(500);
          return {
            error: {
              code: 'JOB_FAILED',
              message: result.error || 'Request processing failed',
            },
            requestId,
          };
        }

        if (config.enableLlmHeaders && result.provider) {
          reply.header('X-LLM-Provider', result.provider);
          reply.header('X-LLM-Model', result.model || '');
          reply.header('X-LLM-Key-ID', result.keyId || '');
          reply.header('X-LLM-Latency-Ms', result.latencyMs?.toString() || '0');
        }

        return result.response;
      } catch (error) {
        if (error instanceof Error && error.message.includes('timed out')) {
          reply.status(408);
          return {
            error: {
              code: 'REQUEST_TIMEOUT',
              message: 'Request is still processing',
            },
            requestId,
          };
        }
        throw error;
      }
    },
  );

  /**
   * GET /api/queue/stats - Get queue statistics
   */
  fastify.get('/queue/stats', async () => {
    const stats = await getQueueStats();
    return stats;
  });
}

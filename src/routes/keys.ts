import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getPrismaClient } from '../utils/database.js';
import { getKeyManager } from '../services/key-manager.js';
import { UsageTracker } from '../services/usage-tracker.js';
import { createLogger } from '../utils/logger.js';
import type { LLMProvider } from '../types/index.js';

const logger = createLogger('keys-route');

// ============================================================================
// Key Management Routes
// ============================================================================

export async function keysRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  /**
   * GET /api/keys - List all API keys (without secrets)
   */
  fastify.get<{
    Querystring: { provider?: string; enabled?: string };
  }>('/keys', async (request) => {
    const { provider, enabled } = request.query;

    const keys = await prisma.llmApiKey.findMany({
      where: {
        ...(provider && { provider: provider as LLMProvider }),
        ...(enabled !== undefined && { enabled: enabled === 'true' }),
      },
      select: {
        id: true,
        provider: true,
        name: true,
        priority: true,
        enabled: true,
        allowedModels: true,
        defaultModel: true,
        dailyLimit: true,
        usedToday: true,
        resetDate: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: [{ provider: 'asc' }, { priority: 'asc' }],
    });

    return {
      keys: keys.map((key) => ({
        ...key,
        remainingQuota: key.dailyLimit === null ? null : key.dailyLimit - key.usedToday,
      })),
      total: keys.length,
    };
  });

  /**
   * POST /api/keys - Create a new API key
   */
  fastify.post<{
    Body: {
      provider: LLMProvider;
      apiKey: string;
      name?: string;
      priority?: number;
      enabled?: boolean;
      allowedModels: string[];
      defaultModel: string;
      dailyLimit?: number | null;
    };
  }>('/keys', async (request, reply) => {
    const {
      provider,
      apiKey,
      name,
      priority = 1,
      enabled = true,
      allowedModels,
      defaultModel,
      dailyLimit,
    } = request.body;

    const key = await prisma.llmApiKey.create({
      data: {
        provider,
        apiKey,
        name,
        priority,
        enabled,
        allowedModels,
        defaultModel,
        dailyLimit,
      },
      select: {
        id: true,
        provider: true,
        name: true,
        priority: true,
        enabled: true,
        allowedModels: true,
        defaultModel: true,
        dailyLimit: true,
        createdAt: true,
      },
    });

    logger.info({ keyId: key.id, provider }, 'API key created');

    reply.status(201);
    return key;
  });

  /**
   * PUT /api/keys/:id - Update an API key
   */
  fastify.put<{
    Params: { id: string };
    Body: {
      name?: string;
      priority?: number;
      enabled?: boolean;
      allowedModels?: string[];
      defaultModel?: string;
      dailyLimit?: number | null;
    };
  }>('/keys/:id', async (request) => {
    const { id } = request.params;
    const updates = request.body;

    const key = await prisma.llmApiKey.update({
      where: { id },
      data: updates,
      select: {
        id: true,
        provider: true,
        name: true,
        priority: true,
        enabled: true,
        allowedModels: true,
        defaultModel: true,
        dailyLimit: true,
        updatedAt: true,
      },
    });

    logger.info({ keyId: id }, 'API key updated');

    return key;
  });

  /**
   * DELETE /api/keys/:id - Delete an API key
   */
  fastify.delete<{ Params: { id: string } }>('/keys/:id', async (request, reply) => {
    const { id } = request.params;

    await prisma.llmApiKey.delete({
      where: { id },
    });

    logger.info({ keyId: id }, 'API key deleted');

    reply.status(204);
    return;
  });

  /**
   * GET /api/keys/:id/usage - Get usage history for a key
   */
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>('/keys/:id/usage', async (request) => {
    const { id } = request.params;
    const limit = parseInt(request.query.limit || '100', 10);

    const usageTracker = new UsageTracker();
    const usage = await usageTracker.getKeyUsage(id, limit);

    return {
      keyId: id,
      usage,
      count: usage.length,
    };
  });

  /**
   * GET /api/keys/stats - Get usage statistics for all keys
   */
  fastify.get('/keys/stats', async () => {
    const keyManager = getKeyManager();
    const stats = await keyManager.getUsageStats();

    return {
      stats,
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * POST /api/keys/:id/reset - Reset daily usage for a key
   */
  fastify.post<{ Params: { id: string } }>('/keys/:id/reset', async (request) => {
    const { id } = request.params;

    const key = await prisma.llmApiKey.update({
      where: { id },
      data: {
        usedToday: 0,
        resetDate: new Date(),
      },
      select: {
        id: true,
        usedToday: true,
        resetDate: true,
      },
    });

    logger.info({ keyId: id }, 'API key usage reset');

    return key;
  });
}

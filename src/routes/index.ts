import type { FastifyInstance } from 'fastify';
import { chatRoutes } from './chat.js';
import { healthRoutes } from './health.js';
import { keysRoutes } from './keys.js';

// ============================================================================
// Route Registration
// ============================================================================

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  // Health routes at root level
  await fastify.register(healthRoutes);

  // API routes under /api prefix
  await fastify.register(
    async (api) => {
      await api.register(chatRoutes);
      await api.register(keysRoutes);
    },
    { prefix: '/api' },
  );
}

export { chatRoutes, healthRoutes, keysRoutes };

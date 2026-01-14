import type { FastifyInstance } from 'fastify';
import { checkDatabaseConnection } from '../utils/database.js';
import { getRedisClient } from '../utils/redis.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('health-route');

// ============================================================================
// Health Check Routes
// ============================================================================

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /health - Basic health check
   */
  fastify.get('/health', async () => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * GET /health/ready - Readiness check (includes dependencies)
   */
  fastify.get('/health/ready', async (_request, reply) => {
    const checks: Record<string, 'healthy' | 'unhealthy'> = {
      database: 'unhealthy',
      redis: 'unhealthy',
    };

    // Check database
    try {
      const dbOk = await checkDatabaseConnection();
      checks['database'] = dbOk ? 'healthy' : 'unhealthy';
    } catch (error) {
      logger.error({ error }, 'Database health check failed');
      checks['database'] = 'unhealthy';
    }

    // Check Redis
    try {
      const redis = getRedisClient();
      await redis.ping();
      checks['redis'] = 'healthy';
    } catch (error) {
      logger.error({ error }, 'Redis health check failed');
      checks['redis'] = 'unhealthy';
    }

    const allHealthy = Object.values(checks).every((v) => v === 'healthy');
    const status = allHealthy ? 'ready' : 'not_ready';

    if (!allHealthy) {
      reply.status(503);
    }

    return {
      status,
      checks,
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * GET /health/live - Liveness check
   */
  fastify.get('/health/live', async () => {
    return {
      status: 'alive',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });
}

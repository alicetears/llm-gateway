import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config/index.js';
import { registerRoutes } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { getPrismaClient, closePrisma, checkDatabaseConnection } from './utils/database.js';
import { getRedisClient, closeRedis } from './utils/redis.js';
import { closeQueues } from './queue/jobs.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('server');

// ============================================================================
// Server Initialization
// ============================================================================

async function buildServer() {
  const fastify = Fastify({
    logger: false, // We use our own logger
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
  });

  // -------------------------------------------------------------------------
  // Plugins
  // -------------------------------------------------------------------------

  // CORS
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    errorResponseBuilder: () => ({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
      },
    }),
  });

  // -------------------------------------------------------------------------
  // Error Handling
  // -------------------------------------------------------------------------

  fastify.setErrorHandler(errorHandler);
  fastify.setNotFoundHandler(notFoundHandler);

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------

  await registerRoutes(fastify);

  // -------------------------------------------------------------------------
  // Lifecycle Hooks
  // -------------------------------------------------------------------------

  fastify.addHook('onRequest', async (request) => {
    logger.debug(
      {
        method: request.method,
        url: request.url,
        requestId: request.id,
      },
      'Incoming request',
    );
  });

  fastify.addHook('onResponse', async (request, reply) => {
    logger.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
        requestId: request.id,
      },
      'Request completed',
    );
  });

  return fastify;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  logger.info('Starting LLM Gateway API...');

  // Initialize connections
  logger.info('Initializing database connection...');
  const dbConnected = await checkDatabaseConnection();
  if (!dbConnected) {
    logger.error('Failed to connect to database');
    process.exit(1);
  }

  logger.info('Initializing Redis connection...');
  try {
    const redis = getRedisClient();
    await redis.ping();
    logger.info('Redis connection established');
  } catch (error) {
    logger.error({ error }, 'Failed to connect to Redis');
    process.exit(1);
  }

  // Build and start server
  const server = await buildServer();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');

    try {
      await server.close();
      logger.info('Server closed');

      await closeQueues();
      await closeRedis();
      await closePrisma();

      logger.info('All connections closed');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start listening
  try {
    await server.listen({
      host: config.host,
      port: config.port,
    });

    logger.info(
      {
        host: config.host,
        port: config.port,
        env: config.nodeEnv,
      },
      `LLM Gateway API is running on http://${config.host}:${config.port}`,
    );
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Run the server
main().catch((error) => {
  logger.error({ error }, 'Unhandled error');
  process.exit(1);
});

export { buildServer };

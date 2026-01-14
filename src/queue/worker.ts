import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../utils/redis.js';
import { createLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { getRouter } from '../services/router.js';
import { QUEUE_NAMES } from './jobs.js';
import type { QueueJobData, QueueJobResult } from '../types/index.js';
import { LLMGatewayError } from '../types/index.js';

const logger = createLogger('queue-worker');

// ============================================================================
// Worker Process
// ============================================================================

let worker: Worker<QueueJobData, QueueJobResult> | null = null;

/**
 * Process a chat request job
 */
async function processChatJob(job: Job<QueueJobData, QueueJobResult>): Promise<QueueJobResult> {
  const { requestId, request } = job.data;
  const startTime = Date.now();

  logger.info(
    {
      jobId: job.id,
      requestId,
      model: request.model,
      provider: request.provider,
      attempt: job.attemptsMade + 1,
    },
    'Processing chat request',
  );

  try {
    const router = getRouter();
    const { response, metadata } = await router.route(request);

    const latencyMs = Date.now() - startTime;

    logger.info(
      {
        jobId: job.id,
        requestId,
        keyId: metadata.keyId,
        provider: metadata.provider,
        model: metadata.model,
        latencyMs,
      },
      'Chat request completed',
    );

    return {
      success: true,
      response,
      keyId: metadata.keyId,
      provider: metadata.provider,
      model: metadata.model,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error(
      {
        jobId: job.id,
        requestId,
        error: errorMessage,
        latencyMs,
      },
      'Chat request failed',
    );

    // Determine if the job should be retried
    if (error instanceof LLMGatewayError && error.statusCode < 500) {
      // Don't retry client errors
      return {
        success: false,
        error: errorMessage,
        latencyMs,
      };
    }

    // Throw to trigger retry
    throw error;
  }
}

/**
 * Start the worker
 */
export function startWorker(): Worker<QueueJobData, QueueJobResult> {
  if (worker) {
    return worker;
  }

  const connection = getRedisClient();

  worker = new Worker<QueueJobData, QueueJobResult>(
    QUEUE_NAMES.CHAT_REQUESTS,
    processChatJob,
    {
      connection,
      concurrency: config.queueConcurrency,
      limiter: {
        max: 100,
        duration: 1000,
      },
    },
  );

  worker.on('completed', (job, result) => {
    logger.debug(
      {
        jobId: job.id,
        success: result.success,
        provider: result.provider,
        model: result.model,
      },
      'Job completed',
    );
  });

  worker.on('failed', (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        error: error.message,
        attempts: job?.attemptsMade,
      },
      'Job failed',
    );
  });

  worker.on('error', (error) => {
    logger.error({ error: error.message }, 'Worker error');
  });

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId }, 'Job stalled');
  });

  logger.info(
    { concurrency: config.queueConcurrency },
    'Queue worker started',
  );

  return worker;
}

/**
 * Stop the worker gracefully
 */
export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Queue worker stopped');
  }
}

// ============================================================================
// Main Entry Point (when run directly)
// ============================================================================

async function main() {
  logger.info('Starting queue worker process...');

  // Handle shutdown signals
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');
    await stopWorker();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start the worker
  startWorker();

  logger.info('Queue worker is running. Press Ctrl+C to stop.');
}

// Run if this is the main module
const isMainModule = process.argv[1]?.endsWith('worker.ts') || 
                     process.argv[1]?.endsWith('worker.js');
if (isMainModule) {
  main().catch((error) => {
    logger.error({ error }, 'Worker failed to start');
    process.exit(1);
  });
}

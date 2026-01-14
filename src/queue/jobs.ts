import { Queue, QueueEvents } from 'bullmq';
import { getRedisClient } from '../utils/redis.js';
import { createLogger } from '../utils/logger.js';
import type { ChatRequest, QueueJobData, QueueJobResult } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('queue-jobs');

// ============================================================================
// Queue Names
// ============================================================================

export const QUEUE_NAMES = {
  CHAT_REQUESTS: 'llm-gateway:chat-requests',
} as const;

// ============================================================================
// Chat Request Queue
// ============================================================================

let chatQueue: Queue<QueueJobData, QueueJobResult> | null = null;
let chatQueueEvents: QueueEvents | null = null;

export function getChatQueue(): Queue<QueueJobData, QueueJobResult> {
  if (!chatQueue) {
    const connection = getRedisClient();
    
    chatQueue = new Queue<QueueJobData, QueueJobResult>(QUEUE_NAMES.CHAT_REQUESTS, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours
        },
      },
    });

    chatQueue.on('error', (error) => {
      logger.error({ error: error.message }, 'Chat queue error');
    });

    logger.info('Chat request queue initialized');
  }

  return chatQueue;
}

export function getChatQueueEvents(): QueueEvents {
  if (!chatQueueEvents) {
    const connection = getRedisClient();
    
    chatQueueEvents = new QueueEvents(QUEUE_NAMES.CHAT_REQUESTS, {
      connection,
    });

    chatQueueEvents.on('completed', ({ jobId, returnvalue }) => {
      // returnvalue is serialized as string, parse it
      try {
        const result = typeof returnvalue === 'string' ? JSON.parse(returnvalue) as QueueJobResult : returnvalue;
        logger.debug({ jobId, success: result?.success }, 'Job completed');
      } catch {
        logger.debug({ jobId }, 'Job completed');
      }
    });

    chatQueueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error({ jobId, reason: failedReason }, 'Job failed');
    });

    logger.info('Chat queue events initialized');
  }

  return chatQueueEvents;
}

// ============================================================================
// Job Management Functions
// ============================================================================

/**
 * Add a chat request to the queue
 */
export async function enqueueChatRequest(
  request: ChatRequest,
  options?: {
    priority?: number;
    delay?: number;
  },
): Promise<string> {
  const queue = getChatQueue();
  const requestId = request.requestId || uuidv4();

  const jobData: QueueJobData = {
    requestId,
    request: { ...request, requestId },
    timestamp: Date.now(),
  };

  const job = await queue.add(requestId, jobData, {
    priority: options?.priority,
    delay: options?.delay,
  });

  logger.info(
    {
      jobId: job.id,
      requestId,
      model: request.model,
      provider: request.provider,
    },
    'Chat request enqueued',
  );

  return requestId;
}

/**
 * Parse returnvalue from BullMQ (it comes as serialized string)
 */
function parseReturnValue(returnvalue: unknown): QueueJobResult | null {
  if (!returnvalue) return null;
  if (typeof returnvalue === 'string') {
    try {
      return JSON.parse(returnvalue) as QueueJobResult;
    } catch {
      return null;
    }
  }
  return returnvalue as QueueJobResult;
}

/**
 * Wait for a queued job to complete
 */
export async function waitForJob(
  requestId: string,
  timeoutMs: number = 120000,
): Promise<QueueJobResult> {
  const queue = getChatQueue();
  const events = getChatQueueEvents();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Job ${requestId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      events.off('completed', onCompleted);
      events.off('failed', onFailed);
    };

    const onCompleted = ({ jobId, returnvalue }: { jobId: string; returnvalue: string }) => {
      if (jobId === requestId) {
        cleanup();
        const result = parseReturnValue(returnvalue);
        if (result) {
          resolve(result);
        } else {
          reject(new Error('Failed to parse job result'));
        }
      }
    };

    const onFailed = ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
      if (jobId === requestId) {
        cleanup();
        reject(new Error(failedReason));
      }
    };

    events.on('completed', onCompleted);
    events.on('failed', onFailed);

    // Check if job is already completed
    queue.getJob(requestId).then((job) => {
      if (job) {
        job.isCompleted().then((completed) => {
          if (completed && job.returnvalue) {
            cleanup();
            resolve(job.returnvalue);
          }
        }).catch(() => { /* ignore */ });
        job.isFailed().then((failed) => {
          if (failed) {
            cleanup();
            reject(new Error(job.failedReason || 'Job failed'));
          }
        }).catch(() => { /* ignore */ });
      }
    }).catch(() => { /* ignore */ });
  });
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const queue = getChatQueue();
  
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

/**
 * Cleanup queues
 */
export async function closeQueues(): Promise<void> {
  if (chatQueueEvents) {
    await chatQueueEvents.close();
    chatQueueEvents = null;
  }
  if (chatQueue) {
    await chatQueue.close();
    chatQueue = null;
  }
  logger.info('Queues closed');
}

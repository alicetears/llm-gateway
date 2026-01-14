import Redis from 'ioredis';
import { config } from '../config/index.js';
import { createLogger } from './logger.js';

const logger = createLogger('redis');

// ============================================================================
// Redis Client
// ============================================================================

let redisClient: Redis | null = null;
let redisAvailable = true;

export function isRedisAvailable(): boolean {
  return redisAvailable && !!config.redisUrl;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    if (!config.redisUrl) {
      redisAvailable = false;
      throw new Error('Redis URL not configured');
    }

    try {
      redisClient = new Redis(config.redisUrl, {
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false,
        lazyConnect: true,
        retryStrategy(times) {
          if (times > 3) {
            redisAvailable = false;
            return null; // Stop retrying
          }
          const delay = Math.min(times * 50, 2000);
          logger.warn({ times, delay }, 'Redis connection retry');
          return delay;
        },
      });

      redisClient.on('connect', () => {
        redisAvailable = true;
        logger.info('Redis connected');
      });

      redisClient.on('error', (err) => {
        logger.error({ error: err.message }, 'Redis connection error');
      });

      redisClient.on('close', () => {
        logger.warn('Redis connection closed');
      });
    } catch (error) {
      redisAvailable = false;
      throw error;
    }
  }

  return redisClient;
}

// ============================================================================
// Redis Key Helpers
// ============================================================================

const KEY_PREFIX = 'llm-gateway';

export const redisKeys = {
  roundRobinIndex: (provider: string, priority: number) =>
    `${KEY_PREFIX}:rr:${provider}:${priority}`,
  keyUsage: (keyId: string, date: string) =>
    `${KEY_PREFIX}:usage:${keyId}:${date}`,
  keyLock: (keyId: string) =>
    `${KEY_PREFIX}:lock:${keyId}`,
  rateLimitWindow: (keyId: string) =>
    `${KEY_PREFIX}:rate:${keyId}`,
};

// ============================================================================
// Round-Robin Index Management
// ============================================================================

export async function getNextRoundRobinIndex(
  provider: string,
  priority: number,
  totalKeys: number,
): Promise<number> {
  const redis = getRedisClient();
  const key = redisKeys.roundRobinIndex(provider, priority);
  
  const current = await redis.incr(key);
  // Set expiry to prevent stale keys
  await redis.expire(key, 3600);
  
  return (current - 1) % totalKeys;
}

// ============================================================================
// Distributed Lock for Key Selection
// ============================================================================

export async function acquireKeyLock(keyId: string, ttlMs: number = 5000): Promise<boolean> {
  const redis = getRedisClient();
  const key = redisKeys.keyLock(keyId);
  
  const result = await redis.set(key, '1', 'PX', ttlMs, 'NX');
  return result === 'OK';
}

export async function releaseKeyLock(keyId: string): Promise<void> {
  const redis = getRedisClient();
  const key = redisKeys.keyLock(keyId);
  await redis.del(key);
}

// ============================================================================
// Cleanup
// ============================================================================

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
}

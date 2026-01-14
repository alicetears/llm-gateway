import { getPrismaClient } from '../utils/database.js';
import { getNextRoundRobinIndex } from '../utils/redis.js';
import { createLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import type {
  ApiKeyInfo,
  KeySelectionResult,
  KeySelectionStrategy,
  LLMProvider,
  RoutingContext,
} from '../types/index.js';
import { NoEligibleKeyError } from '../types/index.js';

const logger = createLogger('key-manager');

// ============================================================================
// Key Manager Service
// ============================================================================

export class KeyManager {
  private strategy: KeySelectionStrategy;

  constructor(strategy?: KeySelectionStrategy) {
    this.strategy = strategy || config.keySelectionStrategy;
  }

  /**
   * Select the best API key based on routing context
   * This is the core key-aware model routing logic
   */
  async selectKey(context: RoutingContext): Promise<KeySelectionResult> {
    const prisma = getPrismaClient();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    logger.debug({ context }, 'Selecting key for request');

    // Build the base query conditions
    const whereConditions: Parameters<typeof prisma.llmApiKey.findMany>[0] = {
      where: {
        enabled: true,
        // Filter by allowed providers if specified
        ...(context.allowedProviders && context.allowedProviders.length > 0
          ? { provider: { in: context.allowedProviders as LLMProvider[] } }
          : {}),
        // Filter by allowed priorities if specified
        ...(context.allowedPriorities && context.allowedPriorities.length > 0
          ? { priority: { in: context.allowedPriorities } }
          : {}),
        // If specific provider requested (not 'auto'), filter by it
        ...(context.requestedProvider !== 'auto'
          ? { provider: context.requestedProvider as LLMProvider }
          : {}),
      },
      orderBy: [{ priority: 'asc' }, { usedToday: 'asc' }],
    };

    // Fetch all eligible keys
    const keys = await prisma.llmApiKey.findMany(whereConditions);

    if (keys.length === 0) {
      throw new NoEligibleKeyError(context.requestedModel, context.requestedProvider);
    }

    // Reset daily usage if needed
    const keysWithResetUsage = await this.resetDailyUsageIfNeeded(keys, today);

    // Filter keys by model compatibility and remaining quota
    const eligibleKeys = this.filterEligibleKeys(
      keysWithResetUsage,
      context.requestedModel,
    );

    if (eligibleKeys.length === 0) {
      throw new NoEligibleKeyError(context.requestedModel, context.requestedProvider);
    }

    // Group keys by priority
    const keysByPriority = this.groupKeysByPriority(eligibleKeys);

    // Select key from the highest priority group
    for (const [priority, priorityKeys] of keysByPriority) {
      const selectedKey = await this.selectKeyFromGroup(
        priorityKeys,
        priority,
        this.strategy,
      );

      if (selectedKey) {
        // Resolve the model to use
        const resolvedModel = context.requestedModel || selectedKey.defaultModel;

        logger.info(
          {
            keyId: selectedKey.id,
            provider: selectedKey.provider,
            model: resolvedModel,
            priority,
            strategy: this.strategy,
          },
          'Key selected',
        );

        return {
          key: selectedKey,
          resolvedModel,
        };
      }
    }

    throw new NoEligibleKeyError(context.requestedModel, context.requestedProvider);
  }

  /**
   * Reset daily usage counters if the reset date has passed
   */
  private async resetDailyUsageIfNeeded(
    keys: ApiKeyInfo[],
    today: Date,
  ): Promise<ApiKeyInfo[]> {
    const prisma = getPrismaClient();
    const keysToReset: string[] = [];
    const updatedKeys: ApiKeyInfo[] = [];

    for (const key of keys) {
      if (key.resetDate < today) {
        keysToReset.push(key.id);
        updatedKeys.push({ ...key, usedToday: 0, resetDate: today });
      } else {
        updatedKeys.push(key);
      }
    }

    // Batch reset keys that need it
    if (keysToReset.length > 0) {
      await prisma.llmApiKey.updateMany({
        where: { id: { in: keysToReset } },
        data: { usedToday: 0, resetDate: today },
      });
      logger.debug({ count: keysToReset.length }, 'Reset daily usage for keys');
    }

    return updatedKeys;
  }

  /**
   * Filter keys by model compatibility and remaining quota
   */
  private filterEligibleKeys(
    keys: ApiKeyInfo[],
    requestedModel?: string,
  ): ApiKeyInfo[] {
    return keys.filter((key) => {
      // Check quota
      if (key.dailyLimit !== null && key.usedToday >= key.dailyLimit) {
        logger.debug({ keyId: key.id, limit: key.dailyLimit }, 'Key quota exhausted');
        return false;
      }

      // If model is requested, check if key supports it
      if (requestedModel) {
        const isAllowed = key.allowedModels.length === 0 || 
          key.allowedModels.some((allowed) => 
            allowed === requestedModel || 
            allowed === '*' ||
            (allowed.endsWith('*') && requestedModel.startsWith(allowed.slice(0, -1)))
          );
        
        if (!isAllowed) {
          logger.debug(
            { keyId: key.id, requestedModel, allowedModels: key.allowedModels },
            'Model not allowed for key',
          );
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Group keys by priority level
   */
  private groupKeysByPriority(keys: ApiKeyInfo[]): Map<number, ApiKeyInfo[]> {
    const grouped = new Map<number, ApiKeyInfo[]>();

    for (const key of keys) {
      const priorityKeys = grouped.get(key.priority) || [];
      priorityKeys.push(key);
      grouped.set(key.priority, priorityKeys);
    }

    // Sort by priority (ascending)
    return new Map([...grouped.entries()].sort((a, b) => a[0] - b[0]));
  }

  /**
   * Select a key from a priority group using the configured strategy
   */
  private async selectKeyFromGroup(
    keys: ApiKeyInfo[],
    priority: number,
    strategy: KeySelectionStrategy,
  ): Promise<ApiKeyInfo | null> {
    if (keys.length === 0) {
      return null;
    }

    if (strategy === 'exhaust-first') {
      // Select the key with the most remaining quota
      return this.selectExhaustFirst(keys);
    } else {
      // Round-robin selection
      return this.selectRoundRobin(keys, priority);
    }
  }

  /**
   * Exhaust-first strategy: use keys until their quota is exhausted
   * Prioritizes keys with higher remaining quota
   */
  private selectExhaustFirst(keys: ApiKeyInfo[]): ApiKeyInfo {
    // Sort by remaining quota (descending)
    const sorted = [...keys].sort((a, b) => {
      const aRemaining = a.dailyLimit === null ? Infinity : a.dailyLimit - a.usedToday;
      const bRemaining = b.dailyLimit === null ? Infinity : b.dailyLimit - b.usedToday;
      return bRemaining - aRemaining;
    });

    return sorted[0]!;
  }

  /**
   * Round-robin strategy: distribute load evenly across keys
   */
  private async selectRoundRobin(
    keys: ApiKeyInfo[],
    priority: number,
  ): Promise<ApiKeyInfo> {
    // Get the provider from the first key (all keys in group have same priority)
    const provider = keys[0]!.provider;
    
    const index = await getNextRoundRobinIndex(provider, priority, keys.length);
    return keys[index]!;
  }

  /**
   * Increment usage counter for a key
   */
  async incrementUsage(keyId: string): Promise<void> {
    const prisma = getPrismaClient();
    
    await prisma.llmApiKey.update({
      where: { id: keyId },
      data: {
        usedToday: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });

    logger.debug({ keyId }, 'Incremented key usage');
  }

  /**
   * Get all keys for a specific provider
   */
  async getKeysByProvider(provider: LLMProvider): Promise<ApiKeyInfo[]> {
    const prisma = getPrismaClient();
    
    return prisma.llmApiKey.findMany({
      where: { provider, enabled: true },
      orderBy: [{ priority: 'asc' }, { usedToday: 'asc' }],
    });
  }

  /**
   * Get usage statistics for all keys
   */
  async getUsageStats(): Promise<
    Array<{
      id: string;
      provider: LLMProvider;
      name: string | null;
      usedToday: number;
      dailyLimit: number | null;
      remainingQuota: number | null;
    }>
  > {
    const prisma = getPrismaClient();
    
    const keys = await prisma.llmApiKey.findMany({
      where: { enabled: true },
      select: {
        id: true,
        provider: true,
        name: true,
        usedToday: true,
        dailyLimit: true,
      },
    });

    return keys.map((key) => ({
      ...key,
      remainingQuota: key.dailyLimit === null ? null : key.dailyLimit - key.usedToday,
    }));
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let keyManagerInstance: KeyManager | null = null;

export function getKeyManager(): KeyManager {
  if (!keyManagerInstance) {
    keyManagerInstance = new KeyManager();
  }
  return keyManagerInstance;
}

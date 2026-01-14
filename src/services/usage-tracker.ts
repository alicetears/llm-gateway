import { getPrismaClient } from '../utils/database.js';
import { createLogger } from '../utils/logger.js';
import type { LLMProvider } from '../types/index.js';

const logger = createLogger('usage-tracker');

// ============================================================================
// Usage Log Entry
// ============================================================================

export interface UsageLogEntry {
  keyId: string;
  provider: LLMProvider;
  model: string;
  requestedModel?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  success: boolean;
  errorMessage?: string;
  requestId?: string;
}

// ============================================================================
// Usage Tracker Service
// ============================================================================

export class UsageTracker {
  /**
   * Log a usage entry to the database
   */
  async logUsage(entry: UsageLogEntry): Promise<void> {
    const prisma = getPrismaClient();

    try {
      await prisma.usageLog.create({
        data: {
          keyId: entry.keyId,
          provider: entry.provider,
          model: entry.model,
          requestedModel: entry.requestedModel,
          promptTokens: entry.promptTokens,
          completionTokens: entry.completionTokens,
          totalTokens: entry.totalTokens,
          latencyMs: entry.latencyMs,
          success: entry.success,
          errorMessage: entry.errorMessage,
          requestId: entry.requestId,
        },
      });

      logger.debug(
        {
          keyId: entry.keyId,
          provider: entry.provider,
          model: entry.model,
          success: entry.success,
        },
        'Usage logged',
      );
    } catch (error) {
      // Log but don't fail the request if usage logging fails
      logger.error({ error, entry }, 'Failed to log usage');
    }
  }

  /**
   * Get usage statistics for a time period
   */
  async getUsageStats(
    startDate: Date,
    endDate: Date,
    groupBy: 'provider' | 'model' | 'key' = 'provider',
  ): Promise<
    Array<{
      group: string;
      totalRequests: number;
      successfulRequests: number;
      failedRequests: number;
      totalTokens: number;
      avgLatencyMs: number;
    }>
  > {
    const prisma = getPrismaClient();

    const logs = await prisma.usageLog.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    // Group and aggregate
    const grouped = new Map<
      string,
      {
        totalRequests: number;
        successfulRequests: number;
        failedRequests: number;
        totalTokens: number;
        totalLatencyMs: number;
        latencyCount: number;
      }
    >();

    for (const log of logs) {
      let groupKey: string;
      switch (groupBy) {
        case 'provider':
          groupKey = log.provider;
          break;
        case 'model':
          groupKey = log.model;
          break;
        case 'key':
          groupKey = log.keyId;
          break;
      }

      const existing = grouped.get(groupKey) || {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalTokens: 0,
        totalLatencyMs: 0,
        latencyCount: 0,
      };

      existing.totalRequests++;
      if (log.success) {
        existing.successfulRequests++;
      } else {
        existing.failedRequests++;
      }
      existing.totalTokens += log.totalTokens || 0;
      if (log.latencyMs) {
        existing.totalLatencyMs += log.latencyMs;
        existing.latencyCount++;
      }

      grouped.set(groupKey, existing);
    }

    return Array.from(grouped.entries()).map(([group, stats]) => ({
      group,
      totalRequests: stats.totalRequests,
      successfulRequests: stats.successfulRequests,
      failedRequests: stats.failedRequests,
      totalTokens: stats.totalTokens,
      avgLatencyMs: stats.latencyCount > 0 ? stats.totalLatencyMs / stats.latencyCount : 0,
    }));
  }

  /**
   * Get recent usage for a specific key
   */
  async getKeyUsage(
    keyId: string,
    limit: number = 100,
  ): Promise<
    Array<{
      model: string;
      success: boolean;
      tokens: number | null;
      latencyMs: number | null;
      createdAt: Date;
    }>
  > {
    const prisma = getPrismaClient();

    const logs = await prisma.usageLog.findMany({
      where: { keyId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        model: true,
        success: true,
        totalTokens: true,
        latencyMs: true,
        createdAt: true,
      },
    });

    return logs.map((log) => ({
      model: log.model,
      success: log.success,
      tokens: log.totalTokens,
      latencyMs: log.latencyMs,
      createdAt: log.createdAt,
    }));
  }

  /**
   * Get daily usage summary
   */
  async getDailySummary(date: Date): Promise<{
    totalRequests: number;
    successRate: number;
    topModels: Array<{ model: string; count: number }>;
    topProviders: Array<{ provider: string; count: number }>;
    avgLatencyMs: number;
    totalTokens: number;
  }> {
    const prisma = getPrismaClient();

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const logs = await prisma.usageLog.findMany({
      where: {
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    const totalRequests = logs.length;
    const successfulRequests = logs.filter((l) => l.success).length;
    const successRate = totalRequests > 0 ? successfulRequests / totalRequests : 0;

    // Count by model
    const modelCounts = new Map<string, number>();
    for (const log of logs) {
      modelCounts.set(log.model, (modelCounts.get(log.model) || 0) + 1);
    }
    const topModels = Array.from(modelCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([model, count]) => ({ model, count }));

    // Count by provider
    const providerCounts = new Map<string, number>();
    for (const log of logs) {
      providerCounts.set(log.provider, (providerCounts.get(log.provider) || 0) + 1);
    }
    const topProviders = Array.from(providerCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([provider, count]) => ({ provider, count }));

    // Calculate averages
    const latencies = logs.filter((l) => l.latencyMs !== null).map((l) => l.latencyMs!);
    const avgLatencyMs = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    const totalTokens = logs.reduce((sum, l) => sum + (l.totalTokens || 0), 0);

    return {
      totalRequests,
      successRate,
      topModels,
      topProviders,
      avgLatencyMs,
      totalTokens,
    };
  }
}

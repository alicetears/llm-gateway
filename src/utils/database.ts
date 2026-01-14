import { PrismaClient } from '@prisma/client';
import { createLogger } from './logger.js';

const logger = createLogger('database');

// ============================================================================
// Prisma Client Singleton
// ============================================================================

let prisma: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });

    // Log queries in development
    prisma.$on('query' as never, (e: { query: string; duration: number }) => {
      logger.debug({ query: e.query, duration: e.duration }, 'Database query');
    });

    prisma.$on('error' as never, (e: { message: string }) => {
      logger.error({ error: e.message }, 'Database error');
    });

    prisma.$on('warn' as never, (e: { message: string }) => {
      logger.warn({ message: e.message }, 'Database warning');
    });
  }

  return prisma;
}

// ============================================================================
// Database Health Check
// ============================================================================

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1`;
    logger.info('Database connection verified');
    return true;
  } catch (error) {
    logger.error({ error }, 'Database connection failed');
    return false;
  }
}

// ============================================================================
// Cleanup
// ============================================================================

export async function closePrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    logger.info('Database connection closed');
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuidv4 } from 'uuid';
import { jwtVerify } from 'jose';
import { ChatRequestSchema } from '../src/types/index.js';
import { getRouter } from '../src/services/router.js';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key-change-in-production');

// ============================================================================
// Auth Helper
// ============================================================================

async function getUserFromToken(req: VercelRequest): Promise<{ userId: string; email: string; role: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  
  try {
    const token = authHeader.slice(7);
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Main API Handler for /api/chat
// ============================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const path = req.url?.split('?')[0] || '/';
  
  try {
    // Route: POST /api/chat (public - uses all enabled keys)
    if (req.method === 'POST' && (path === '/api/chat' || path === '/api')) {
      return await handleChatRequest(req, res);
    }

    // Protected routes - require auth
    const user = await getUserFromToken(req);
    if (!user && (path.startsWith('/api/keys') || path === '/api/queue/stats')) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } });
    }

    // Route: GET /api/keys
    if (req.method === 'GET' && path === '/api/keys') {
      return await handleListKeys(req, res, user!);
    }

    // Route: POST /api/keys
    if (req.method === 'POST' && path === '/api/keys') {
      return await handleCreateKey(req, res, user!);
    }

    // Route: DELETE /api/keys/:id
    if (req.method === 'DELETE' && path.startsWith('/api/keys/')) {
      const keyId = path.split('/')[3];
      return await handleDeleteKey(req, res, user!, keyId!);
    }

    // Route: GET /api/keys/stats
    if (req.method === 'GET' && path === '/api/keys/stats') {
      return await handleKeyStats(res, user!);
    }

    // Route: GET /api/queue/stats
    if (req.method === 'GET' && path === '/api/queue/stats') {
      return res.status(200).json({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        message: 'Queue stats not available in serverless mode',
      });
    }

    // 404 for unknown routes
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${path} not found`,
      },
    });
  } catch (error) {
    console.error('API Error:', error);
    
    if (error instanceof Error) {
      // Check for known error types
      if ('statusCode' in error) {
        const err = error as Error & { statusCode: number; code?: string };
        return res.status(err.statusCode).json({
          error: {
            code: err.code || 'ERROR',
            message: err.message,
          },
        });
      }
    }

    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  }
}

// ============================================================================
// Chat Request Handler
// ============================================================================

async function handleChatRequest(req: VercelRequest, res: VercelResponse) {
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();

  // Validate request body
  const parseResult = ChatRequestSchema.safeParse({
    ...req.body,
    requestId,
  });

  if (!parseResult.success) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: {
          issues: parseResult.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      requestId,
    });
  }

  const validatedBody = parseResult.data;

  // Process the request
  const router = getRouter();
  const { response, metadata } = await router.route(validatedBody);

  // Add LLM headers
  res.setHeader('X-LLM-Provider', metadata.provider);
  res.setHeader('X-LLM-Model', metadata.model);
  res.setHeader('X-LLM-Key-ID', metadata.keyId);
  res.setHeader('X-LLM-Latency-Ms', metadata.latencyMs.toString());

  return res.status(200).json({
    id: response.id,
    provider: response.provider,
    model: response.model,
    choices: response.choices.map((choice) => ({
      index: choice.index,
      message: {
        role: choice.message.role,
        content: choice.message.content,
      },
      finishReason: choice.finishReason,
    })),
    usage: response.usage,
    created: response.created,
  });
}

// ============================================================================
// Keys Handlers
// ============================================================================

interface AuthUser {
  userId: string;
  email: string;
  role: string;
}

async function handleListKeys(req: VercelRequest, res: VercelResponse, user: AuthUser) {
  const { getPrismaClient } = await import('../src/utils/database.js');
  const prisma = getPrismaClient();
  
  const provider = req.query['provider'] as string | undefined;
  const enabled = req.query['enabled'] as string | undefined;

  // Users see only their own keys, admins see all
  const keys = await prisma.llmApiKey.findMany({
    where: {
      ...(user.role !== 'admin' && { userId: user.userId }),
      ...(provider && { provider: provider as never }),
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
      userId: true,
    },
    orderBy: [{ provider: 'asc' }, { priority: 'asc' }],
  });

  return res.status(200).json({
    keys: keys.map((key) => ({
      ...key,
      remainingQuota: key.dailyLimit === null ? null : key.dailyLimit - key.usedToday,
      isOwner: key.userId === user.userId,
    })),
    total: keys.length,
  });
}

async function handleCreateKey(req: VercelRequest, res: VercelResponse, user: AuthUser) {
  const { getPrismaClient } = await import('../src/utils/database.js');
  const prisma = getPrismaClient();

  const {
    provider,
    apiKey,
    name,
    priority = 1,
    enabled = true,
    allowedModels,
    defaultModel,
    dailyLimit,
  } = req.body;

  if (!provider || !apiKey || !defaultModel) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields: provider, apiKey, defaultModel',
      },
    });
  }

  const key = await prisma.llmApiKey.create({
    data: {
      provider,
      apiKey,
      name,
      priority,
      enabled,
      allowedModels: allowedModels || [],
      defaultModel,
      dailyLimit,
      userId: user.userId,
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

  return res.status(201).json(key);
}

async function handleDeleteKey(req: VercelRequest, res: VercelResponse, user: AuthUser, keyId: string) {
  const { getPrismaClient } = await import('../src/utils/database.js');
  const prisma = getPrismaClient();

  // Find the key first
  const key = await prisma.llmApiKey.findUnique({ where: { id: keyId } });
  
  if (!key) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Key not found' } });
  }

  // Only owner or admin can delete
  if (key.userId !== user.userId && user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized to delete this key' } });
  }

  await prisma.llmApiKey.delete({ where: { id: keyId } });

  return res.status(204).end();
}

async function handleKeyStats(res: VercelResponse, user: AuthUser) {
  const { getPrismaClient } = await import('../src/utils/database.js');
  const prisma = getPrismaClient();

  // Users see only their own stats, admins see all
  const keys = await prisma.llmApiKey.findMany({
    where: user.role !== 'admin' ? { userId: user.userId } : {},
    select: {
      id: true,
      provider: true,
      name: true,
      usedToday: true,
      dailyLimit: true,
    },
  });

  const stats = keys.map((key) => ({
    id: key.id,
    provider: key.provider,
    name: key.name,
    usedToday: key.usedToday,
    dailyLimit: key.dailyLimit,
    remainingQuota: key.dailyLimit === null ? null : key.dailyLimit - key.usedToday,
  }));

  return res.status(200).json({
    stats,
    timestamp: new Date().toISOString(),
  });
}

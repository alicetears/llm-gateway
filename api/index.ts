import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuidv4 } from 'uuid';
import { ChatRequestSchema } from '../src/types/index.js';
import { getRouter } from '../src/services/router.js';

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
    // Route: POST /api/chat
    if (req.method === 'POST' && (path === '/api/chat' || path === '/api')) {
      return await handleChatRequest(req, res);
    }

    // Route: GET /api/keys
    if (req.method === 'GET' && path === '/api/keys') {
      return await handleListKeys(req, res);
    }

    // Route: POST /api/keys
    if (req.method === 'POST' && path === '/api/keys') {
      return await handleCreateKey(req, res);
    }

    // Route: GET /api/keys/stats
    if (req.method === 'GET' && path === '/api/keys/stats') {
      return await handleKeyStats(res);
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

async function handleListKeys(req: VercelRequest, res: VercelResponse) {
  const { getPrismaClient } = await import('../src/utils/database.js');
  const prisma = getPrismaClient();
  
  const provider = req.query['provider'] as string | undefined;
  const enabled = req.query['enabled'] as string | undefined;

  const keys = await prisma.llmApiKey.findMany({
    where: {
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
    },
    orderBy: [{ provider: 'asc' }, { priority: 'asc' }],
  });

  return res.status(200).json({
    keys: keys.map((key) => ({
      ...key,
      remainingQuota: key.dailyLimit === null ? null : key.dailyLimit - key.usedToday,
    })),
    total: keys.length,
  });
}

async function handleCreateKey(req: VercelRequest, res: VercelResponse) {
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

async function handleKeyStats(res: VercelResponse) {
  const { getKeyManager } = await import('../src/services/key-manager.js');
  const keyManager = getKeyManager();
  const stats = await keyManager.getUsageStats();

  return res.status(200).json({
    stats,
    timestamp: new Date().toISOString(),
  });
}

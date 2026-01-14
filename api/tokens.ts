import type { VercelRequest, VercelResponse } from '@vercel/node';
import { jwtVerify } from 'jose';
import crypto from 'crypto';
import { getPrismaClient } from '../src/utils/database.js';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'INSECURE-CHANGE-ME');

// ============================================================================
// Token API Handler
// ============================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Require auth for all token operations
  const user = await getUserFromToken(req);
  if (!user) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } });
  }

  const path = req.url?.split('?')[0] || '/';

  try {
    // GET /api/tokens - List user's tokens
    if (req.method === 'GET' && path === '/api/tokens') {
      return await handleListTokens(res, user);
    }

    // POST /api/tokens - Create new token
    if (req.method === 'POST' && path === '/api/tokens') {
      return await handleCreateToken(req, res, user);
    }

    // DELETE /api/tokens/:id - Delete token
    if (req.method === 'DELETE' && path.startsWith('/api/tokens/')) {
      const tokenId = path.split('/')[3];
      return await handleDeleteToken(res, user, tokenId!);
    }

    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  } catch (error) {
    console.error('Token API error:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
}

// ============================================================================
// Auth Helper
// ============================================================================

async function getUserFromToken(req: VercelRequest): Promise<{ userId: string; role: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  
  try {
    const token = authHeader.slice(7);
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return { userId: payload.userId as string, role: payload.role as string };
  } catch {
    return null;
  }
}

// ============================================================================
// Handlers
// ============================================================================

async function handleListTokens(res: VercelResponse, user: { userId: string }) {
  const prisma = getPrismaClient();
  
  const tokens = await prisma.apiToken.findMany({
    where: { userId: user.userId },
    select: {
      id: true,
      name: true,
      enabled: true,
      expiresAt: true,
      lastUsedAt: true,
      usageCount: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.status(200).json({ tokens });
}

async function handleCreateToken(req: VercelRequest, res: VercelResponse, user: { userId: string }) {
  const prisma = getPrismaClient();
  const { name, expiresInDays } = req.body;

  if (!name) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Token name is required' } });
  }

  // Generate random token
  const rawToken = `llm_${crypto.randomBytes(32).toString('hex')}`;
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Calculate expiry
  const expiresAt = expiresInDays 
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const token = await prisma.apiToken.create({
    data: {
      token: hashedToken,
      name,
      userId: user.userId,
      expiresAt,
    },
    select: {
      id: true,
      name: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  // Return the raw token ONCE - it cannot be retrieved again
  return res.status(201).json({
    ...token,
    token: rawToken, // Only shown once!
    message: 'Save this token! It will not be shown again.',
  });
}

async function handleDeleteToken(res: VercelResponse, user: { userId: string; role: string }, tokenId: string) {
  const prisma = getPrismaClient();

  const token = await prisma.apiToken.findUnique({ where: { id: tokenId } });
  
  if (!token) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Token not found' } });
  }

  if (token.userId !== user.userId && user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } });
  }

  await prisma.apiToken.delete({ where: { id: tokenId } });

  return res.status(204).end();
}

// ============================================================================
// Export: Validate API Token (used by chat endpoint)
// ============================================================================

export async function validateApiToken(rawToken: string): Promise<{ userId: string } | null> {
  if (!rawToken.startsWith('llm_')) {
    return null;
  }

  const prisma = getPrismaClient();
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  const token = await prisma.apiToken.findUnique({
    where: { token: hashedToken },
    include: { user: true },
  });

  if (!token || !token.enabled) {
    return null;
  }

  // Check expiry
  if (token.expiresAt && token.expiresAt < new Date()) {
    return null;
  }

  // Update usage stats
  await prisma.apiToken.update({
    where: { id: token.id },
    data: {
      lastUsedAt: new Date(),
      usageCount: { increment: 1 },
    },
  });

  return { userId: token.userId };
}

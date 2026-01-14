import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { getPrismaClient } from '../src/utils/database.js';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key-change-in-production');

// ============================================================================
// Auth API Handler
// ============================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const path = req.url?.split('?')[0] || '/';

  try {
    // POST /api/auth/register
    if (req.method === 'POST' && path === '/api/auth/register') {
      return await handleRegister(req, res);
    }

    // POST /api/auth/login
    if (req.method === 'POST' && path === '/api/auth/login') {
      return await handleLogin(req, res);
    }

    // GET /api/auth/me
    if (req.method === 'GET' && path === '/api/auth/me') {
      return await handleMe(req, res);
    }

    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
}

// ============================================================================
// Register
// ============================================================================

async function handleRegister(req: VercelRequest, res: VercelResponse) {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Email and password required' } });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 6 characters' } });
  }

  const prisma = getPrismaClient();

  // Check if user exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(400).json({ error: { code: 'USER_EXISTS', message: 'Email already registered' } });
  }

  // Check if this is the first user (make them admin)
  const userCount = await prisma.user.count();
  const role = userCount === 0 ? 'admin' : 'user';

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: name || null,
      role,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  // Generate token
  const token = await new SignJWT({ userId: user.id, email: user.email, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(JWT_SECRET);

  return res.status(201).json({
    user,
    token,
    message: role === 'admin' ? 'Admin account created!' : 'Account created!',
  });
}

// ============================================================================
// Login
// ============================================================================

async function handleLogin(req: VercelRequest, res: VercelResponse) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Email and password required' } });
  }

  const prisma = getPrismaClient();

  // Find user
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
  }

  if (!user.enabled) {
    return res.status(401).json({ error: { code: 'ACCOUNT_DISABLED', message: 'Account is disabled' } });
  }

  // Check password
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
  }

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  // Generate token
  const token = await new SignJWT({ userId: user.id, email: user.email, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(JWT_SECRET);

  return res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    token,
  });
}

// ============================================================================
// Get Current User
// ============================================================================

async function handleMe(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
  }

  const token = authHeader.slice(7);

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const prisma = getPrismaClient();

    const user = await prisma.user.findUnique({
      where: { id: payload.userId as string },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not found' } });
    }

    return res.status(200).json({ user });
  } catch {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }
}

// ============================================================================
// Export verify function for other routes
// ============================================================================

export async function verifyToken(token: string): Promise<{ userId: string; email: string; role: string } | null> {
  try {
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

import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { getPrismaClient } from '../src/utils/database.js';

const JWT_SECRET_STRING = process.env.JWT_SECRET;
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_STRING || 'INSECURE-CHANGE-ME');

// Simple in-memory rate limiting for auth
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_AUTH_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = authAttempts.get(ip);
  
  if (!record || now > record.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return true;
  }
  
  if (record.count >= MAX_AUTH_ATTEMPTS) {
    return false;
  }
  
  record.count++;
  return true;
}

function getClientIP(req: VercelRequest): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
         (req.headers['x-real-ip'] as string) || 
         'unknown';
}

// ============================================================================
// Auth Helper
// ============================================================================

async function getAuthUser(req: VercelRequest): Promise<{ userId: string; email: string; role: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  
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
// System Settings Helper
// ============================================================================

async function getSystemSettings() {
  const prisma = getPrismaClient();
  
  // Get or create system settings (singleton pattern)
  let settings = await prisma.systemSettings.findUnique({
    where: { id: 'system' },
  });
  
  if (!settings) {
    // First time: check if admin exists to set initial state
    const adminExists = await prisma.user.findFirst({ where: { role: 'admin' } });
    
    settings = await prisma.systemSettings.create({
      data: {
        id: 'system',
        // SECURITY: If admin exists, disable registration by default
        // If no admin, enable registration so first user can register
        registrationEnabled: !adminExists,
      },
    });
  }
  
  return settings;
}

// ============================================================================
// Auth API Handler
// ============================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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

    // GET /api/auth/settings - Get registration status (public)
    if (req.method === 'GET' && path === '/api/auth/settings') {
      return await handleGetSettings(res);
    }

    // PUT /api/auth/settings - Admin only: toggle registration
    if (req.method === 'PUT' && path === '/api/auth/settings') {
      return await handleUpdateSettings(req, res);
    }

    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
}

// ============================================================================
// Register - With Registration Gate
// ============================================================================

async function handleRegister(req: VercelRequest, res: VercelResponse) {
  const { email, password, name, role: requestedRole } = req.body;

  // SECURITY: Reject any attempt to self-assign admin role
  if (requestedRole === 'admin') {
    return res.status(403).json({ 
      error: { code: 'FORBIDDEN', message: 'Cannot self-assign admin role' } 
    });
  }

  if (!email || !password) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Email and password required' } });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 6 characters' } });
  }

  const prisma = getPrismaClient();

  // Check if this is the first user (will become admin)
  const userCount = await prisma.user.count();
  const isFirstUser = userCount === 0;

  // SECURITY: Check registration gate (skip for first user who becomes admin)
  if (!isFirstUser) {
    const settings = await getSystemSettings();
    
    if (!settings.registrationEnabled) {
      // SECURITY: Registration is disabled by admin
      return res.status(403).json({ 
        error: { 
          code: 'REGISTRATION_DISABLED', 
          message: 'Registration is currently disabled by the administrator.' 
        } 
      });
    }
  }

  // Check if user exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(400).json({ error: { code: 'USER_EXISTS', message: 'Email already registered' } });
  }

  // SECURITY: First user becomes admin, all others are regular users
  const role = isFirstUser ? 'admin' : 'user';

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

  // SECURITY: If first user (admin) was just created, disable registration
  if (isFirstUser) {
    await prisma.systemSettings.upsert({
      where: { id: 'system' },
      create: {
        id: 'system',
        registrationEnabled: false, // Disable after admin created
        updatedBy: user.id,
      },
      update: {
        registrationEnabled: false,
        updatedBy: user.id,
      },
    });
  }

  // Generate token
  const token = await new SignJWT({ userId: user.id, email: user.email, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(JWT_SECRET);

  return res.status(201).json({
    user,
    token,
    message: role === 'admin' 
      ? 'Admin account created! Registration is now disabled.' 
      : 'Account created!',
  });
}

// ============================================================================
// Login - Always allowed for existing users
// ============================================================================

async function handleLogin(req: VercelRequest, res: VercelResponse) {
  // Rate limiting
  const clientIP = getClientIP(req);
  if (!checkRateLimit(clientIP)) {
    return res.status(429).json({ 
      error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in 15 minutes.' } 
    });
  }

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

  // SECURITY: Existing users can always log in (registration gate doesn't affect login)
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
  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
  }

  const prisma = getPrismaClient();

  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  if (!dbUser) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not found' } });
  }

  // Include settings for admin users
  let settings = null;
  if (dbUser.role === 'admin') {
    settings = await getSystemSettings();
  }

  return res.status(200).json({ 
    user: dbUser,
    settings: settings ? { registrationEnabled: settings.registrationEnabled } : undefined,
  });
}

// ============================================================================
// Get Settings (Public) - Shows registration status
// ============================================================================

async function handleGetSettings(res: VercelResponse) {
  const settings = await getSystemSettings();
  const prisma = getPrismaClient();
  
  // Check if any admin exists
  const adminExists = await prisma.user.findFirst({ where: { role: 'admin' } });
  
  return res.status(200).json({
    registrationEnabled: settings.registrationEnabled,
    // SECURITY: Only reveal if first user needs to be created
    needsSetup: !adminExists,
  });
}

// ============================================================================
// Update Settings (Admin Only) - Toggle registration
// ============================================================================

async function handleUpdateSettings(req: VercelRequest, res: VercelResponse) {
  // SECURITY: Require valid JWT
  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }

  // SECURITY: Admin role check - only admins can modify settings
  if (user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }

  const { registrationEnabled } = req.body;

  if (typeof registrationEnabled !== 'boolean') {
    return res.status(400).json({ 
      error: { code: 'VALIDATION_ERROR', message: 'registrationEnabled must be a boolean' } 
    });
  }

  const prisma = getPrismaClient();

  // SECURITY: Verify user is still admin in database (prevent stale tokens)
  const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!dbUser || dbUser.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }

  // Update settings
  const settings = await prisma.systemSettings.upsert({
    where: { id: 'system' },
    create: {
      id: 'system',
      registrationEnabled,
      updatedBy: user.userId,
    },
    update: {
      registrationEnabled,
      updatedBy: user.userId,
    },
  });

  return res.status(200).json({
    registrationEnabled: settings.registrationEnabled,
    message: registrationEnabled 
      ? 'Registration enabled. New users can now register.' 
      : 'Registration disabled. Only existing users can log in.',
  });
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

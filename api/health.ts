import type { VercelRequest, VercelResponse } from '@vercel/node';

// ============================================================================
// Health Check Handler
// ============================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const path = req.url?.split('?')[0] || '/';

  // Route: GET /health
  if (path === '/health') {
    return res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
  }

  // Route: GET /health/live
  if (path === '/health/live') {
    return res.status(200).json({
      status: 'alive',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }

  // Route: GET /health/ready
  if (path === '/health/ready') {
    const checks: Record<string, 'healthy' | 'unhealthy'> = {
      database: 'unhealthy',
      redis: 'healthy', // Redis is optional in serverless
    };

    try {
      const { checkDatabaseConnection } = await import('../src/utils/database.js');
      const dbOk = await checkDatabaseConnection();
      checks['database'] = dbOk ? 'healthy' : 'unhealthy';
    } catch {
      checks['database'] = 'unhealthy';
    }

    const allHealthy = Object.values(checks).every((v) => v === 'healthy');
    const status = allHealthy ? 'ready' : 'not_ready';

    return res.status(allHealthy ? 200 : 503).json({
      status,
      checks,
      timestamp: new Date().toISOString(),
    });
  }

  return res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${path} not found`,
    },
  });
}

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logError, withApiMonitoring } from '@/lib/monitoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function runReadinessCheck() {
  const checks = {
    app: 'ok',
    env: {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
    },
    database: 'unknown',
  };

  if (!checks.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is not configured');
    error.code = 'MISSING_DATABASE_URL';
    throw error;
  }

  await prisma.$queryRaw`SELECT 1`;
  checks.database = 'ok';

  return checks;
}

function buildHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    ...extra,
  };
}

export async function GET(request) {
  return withApiMonitoring(request, async ({ requestId }) => {
    try {
      const checks = await runReadinessCheck();

      return NextResponse.json(
        {
          status: 'ok',
          timestamp: new Date().toISOString(),
          requestId,
          checks,
        },
        {
          status: 200,
          headers: buildHeaders(),
        }
      );
    } catch (error) {
      logError('ready.check_failed', error, { requestId, route: '/api/ready' });

      return NextResponse.json(
        {
          status: 'error',
          timestamp: new Date().toISOString(),
          requestId,
          checks: {
            app: 'ok',
            env: {
              DATABASE_URL: Boolean(process.env.DATABASE_URL),
            },
            database: 'error',
          },
          error: 'Service is not ready.',
          reason: error?.code || error?.message || 'UNKNOWN_ERROR',
        },
        {
          status: 503,
          headers: buildHeaders(),
        }
      );
    }
  }, { route: '/api/ready' });
}

export async function HEAD(request) {
  return withApiMonitoring(request, async ({ requestId }) => {
    try {
      await runReadinessCheck();
      return new NextResponse(null, {
        status: 200,
        headers: buildHeaders({ 'x-request-id': requestId }),
      });
    } catch (error) {
      logError('ready.head_check_failed', error, { requestId, route: '/api/ready' });
      return new NextResponse(null, {
        status: 503,
        headers: buildHeaders({ 'x-request-id': requestId }),
      });
    }
  }, { route: '/api/ready' });
}

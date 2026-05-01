import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

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

function buildHeaders() {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };
}

export async function GET() {
  try {
    const checks = await runReadinessCheck();

    return NextResponse.json(
      {
        status: 'ok',
        timestamp: new Date().toISOString(),
        checks,
      },
      {
        status: 200,
        headers: buildHeaders(),
      }
    );
  } catch (error) {
    console.error('ready check failed', error);

    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
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
}

export async function HEAD() {
  try {
    await runReadinessCheck();
    return new NextResponse(null, {
      status: 200,
      headers: buildHeaders(),
    });
  } catch (error) {
    console.error('ready head check failed', error);
    return new NextResponse(null, {
      status: 503,
      headers: buildHeaders(),
    });
  }
}

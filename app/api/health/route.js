import { NextResponse } from 'next/server';
import { getHealthStatus, withApiMonitoring } from '@/lib/monitoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function headers() {
  return { 'Cache-Control': 'no-store, no-cache, must-revalidate' };
}

function httpStatusFromHealth(status) {
  return status === 'error' ? 503 : 200;
}

export async function GET(request) {
  return withApiMonitoring(request, async () => {
    const health = await getHealthStatus();
    return NextResponse.json(health, { status: httpStatusFromHealth(health.status), headers: headers() });
  }, { route: '/api/health' });
}

export async function HEAD(request) {
  return withApiMonitoring(request, async () => {
    const health = await getHealthStatus();
    return new NextResponse(null, { status: httpStatusFromHealth(health.status), headers: headers() });
  }, { route: '/api/health' });
}

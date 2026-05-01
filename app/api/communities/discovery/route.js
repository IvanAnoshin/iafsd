import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { listCommunityDiscovery } from '@/lib/communities';

function buildDiscoveryFallbackPayload() {
  return {
    discovery: { recommended: [], trending: [], mine: [], tags: [] },
    degraded: true,
  };
}

export async function GET(request) {
  let session = null;

  try {
    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const { searchParams } = new URL(request.url);
    const discovery = await listCommunityDiscovery(session.user.id, { limit: searchParams.get('limit') || 8 });
    return NextResponse.json({ discovery }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.warn('communities/discovery fallback enabled', error?.message || error);
    if (!session?.user) {
      return NextResponse.json({ error: 'Не удалось загрузить подборки сообществ.' }, { status: 500 });
    }

    return NextResponse.json(buildDiscoveryFallbackPayload(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

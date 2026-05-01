import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { listSimilarCommunities } from '@/lib/communities';

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const communities = await listSimilarCommunities(slug, session.user.id, { limit: searchParams.get('limit') || 6 });
    return NextResponse.json({ communities }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.warn('communities/similar fallback enabled', error?.message || error);
    const status = error?.status || 500;
    if (status !== 500) {
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ communities: [], degraded: true }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

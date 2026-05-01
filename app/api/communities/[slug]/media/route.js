import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { listCommunityMedia } from '@/lib/communities';

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || 80;
    const cursor = searchParams.get('cursor') || '';
    const result = await listCommunityMedia(slug, session.user.id, { limit, cursor });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.warn('community media fallback enabled', error?.message || error);
    const status = error?.status || 500;
    if (status !== 500) {
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({
      media: [],
      items: [],
      page: { has_more: false, next_cursor: null },
      degraded: true,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
}

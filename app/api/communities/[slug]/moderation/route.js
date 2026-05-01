import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { listCommunityModerationActions, listCommunityModerationQueue } from '@/lib/communities';

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || 30;
    const [actions, queue] = await Promise.all([
      listCommunityModerationActions(slug, session.user.id, { limit }),
      listCommunityModerationQueue(slug, session.user.id, { limit }),
    ]);
    return NextResponse.json({ actions, queue }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/moderation list failed', error);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось загрузить модерацию сообщества.' : error.message }, { status });
  }
}

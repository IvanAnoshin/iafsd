import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { listNotifications } from '@/lib/notifications';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);

    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') || 30);
    const unreadOnly = searchParams.get('unread_only') || searchParams.get('unreadOnly');

    const result = await listNotifications(session.user.id, { limit, unreadOnly });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('notifications get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить уведомления.' }, { status: 500 });
  }
}

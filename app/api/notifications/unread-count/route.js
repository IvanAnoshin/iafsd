import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { countUnreadNotifications } from '@/lib/notifications';

export async function GET() {
  let session = null;

  try {
    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);

    const unreadCount = await countUnreadNotifications(session.user.id);
    return NextResponse.json({ unread_count: unreadCount }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.warn('notifications unread count fallback enabled', error?.message || error);
    if (!session?.user) {
      return NextResponse.json({ error: 'Не удалось загрузить счётчик уведомлений.' }, { status: 500 });
    }

    return NextResponse.json({ unread_count: 0, unreadCount: 0, degraded: true }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

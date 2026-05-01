import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { markNotificationRead, countUnreadNotifications } from '@/lib/notifications';

export async function PUT(request, { params }) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);

    const { id } = await params;
    const notificationId = Number(id);
    if (!Number.isFinite(notificationId)) {
      return NextResponse.json({ error: 'Некорректное уведомление.' }, { status: 400 });
    }

    const item = await markNotificationRead(session.user.id, notificationId);
    if (!item) return NextResponse.json({ error: 'Уведомление не найдено.' }, { status: 404 });

    const unreadCount = await countUnreadNotifications(session.user.id);
    return NextResponse.json({ item, unread_count: unreadCount });
  } catch (error) {
    console.error('notification read failed', error);
    return NextResponse.json({ error: 'Не удалось отметить уведомление прочитанным.' }, { status: 500 });
  }
}

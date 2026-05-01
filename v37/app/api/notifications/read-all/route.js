import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { markAllNotificationsRead } from '@/lib/notifications';

export async function PUT(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);

    const result = await markAllNotificationsRead(session.user.id);
    return NextResponse.json({ message: 'Все уведомления отмечены прочитанными.', ...result });
  } catch (error) {
    console.error('notifications read all failed', error);
    return NextResponse.json({ error: 'Не удалось отметить уведомления прочитанными.' }, { status: 500 });
  }
}

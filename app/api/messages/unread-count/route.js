import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { countUnreadMessages } from '@/lib/chat';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const unreadCount = await countUnreadMessages(session.user.id);
    return NextResponse.json({ unreadCount }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat unread count failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось получить число непрочитанных сообщений.' }, { status: error?.status || 500 });
  }
}

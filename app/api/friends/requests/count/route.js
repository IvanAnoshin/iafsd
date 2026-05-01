import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { getPendingIncomingFriendRequestsCount } from '@/lib/social';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const count = await getPendingIncomingFriendRequestsCount(session.user.id);
    return NextResponse.json({ count }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('friends requests count failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить количество входящих заявок.' }, { status: 500 });
  }
}

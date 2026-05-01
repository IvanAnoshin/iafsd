import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { getIncomingFriendRequests } from '@/lib/social';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    const items = await getIncomingFriendRequests(session.user.id);
    return NextResponse.json({ items, count: items.length });
  } catch (error) {
    console.error('friends/requests get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить входящие заявки.' }, { status: 500 });
  }
}

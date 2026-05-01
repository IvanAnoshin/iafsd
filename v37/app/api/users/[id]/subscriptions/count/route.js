import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { getSocialCounts } from '@/lib/social';

export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    const userId = Number((await params).id);
    if (!userId) {
      return NextResponse.json({ error: 'Некорректный пользователь.' }, { status: 400 });
    }

    await touchSession(session.id);
    const counts = await getSocialCounts(userId);
    return NextResponse.json(
      { count: counts.subscriptionsCount },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('users/subscriptions/count failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить количество подписок.' }, { status: 500 });
  }
}

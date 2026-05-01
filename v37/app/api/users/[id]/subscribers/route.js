import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { getUserFollowers } from '@/lib/social';

export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    const userId = Number((await params).id);
    if (!userId) return NextResponse.json({ error: 'Некорректный пользователь.' }, { status: 400 });

    const items = await getUserFollowers(userId);
    return NextResponse.json({ items, count: items.length });
  } catch (error) {
    console.error('users/subscribers get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить подписчиков.' }, { status: 500 });
  }
}

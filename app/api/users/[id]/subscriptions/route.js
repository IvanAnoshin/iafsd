import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { getProfilePrivacyState } from '@/lib/user-preferences';
import prisma from '@/lib/prisma';
import { getUserFollowing } from '@/lib/social';

export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    const userId = Number((await params).id);
    if (!userId) return NextResponse.json({ error: 'Некорректный пользователь.' }, { status: 400 });

    const privacy = await getProfilePrivacyState(session.user.id, userId, prisma);
    if (!privacy.canSeeActivity) {
      return NextResponse.json({ items: [], count: 0, restricted: true }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const items = await getUserFollowing(userId);
    return NextResponse.json({ items, count: items.length, restricted: false }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('users/subscriptions get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить подписки.' }, { status: 500 });
  }
}

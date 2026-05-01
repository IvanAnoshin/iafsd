import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { getSocialCounts } from '@/lib/social';
import prisma from '@/lib/prisma';
import { getProfilePrivacyState } from '@/lib/user-preferences';

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
    const privacy = await getProfilePrivacyState(session.user.id, userId, prisma);
    if (!privacy.canSeeActivity) {
      return NextResponse.json({ count: 0, restricted: true }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const counts = await getSocialCounts(userId);
    return NextResponse.json(
      { count: counts.followersCount, restricted: false },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('users/subscribers/count failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить количество подписчиков.' }, { status: 500 });
  }
}

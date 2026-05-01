import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { getUserPreferences, getViewerRelation, isVisibilityAllowed } from '@/lib/user-preferences';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const userId = Number((await params).id);
    if (!userId) {
      return NextResponse.json({ error: 'Некорректный пользователь.' }, { status: 400 });
    }

    const preferences = await getUserPreferences(userId, prisma);
    const relation = await getViewerRelation(session.user.id, userId, prisma);
    if (!isVisibilityAllowed(preferences.activity_visibility, relation)) {
      return NextResponse.json({ user_id: userId, is_online: false, last_seen_at: null, restricted: true });
    }

    const latestSession = await prisma.session.findFirst({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: { lastSeenAt: true },
    });

    if (!latestSession) {
      return NextResponse.json({ user_id: userId, is_online: false, last_seen_at: null });
    }

    const isOnline = Date.now() - latestSession.lastSeenAt.getTime() <= ONLINE_WINDOW_MS;

    return NextResponse.json({
      user_id: userId,
      is_online: isOnline,
      last_seen_at: latestSession.lastSeenAt,
    });
  } catch (error) {
    console.error('users/online-status failed', error);
    return NextResponse.json({ error: 'Не удалось получить онлайн-статус.' }, { status: 500 });
  }
}

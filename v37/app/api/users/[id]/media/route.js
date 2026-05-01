import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { collectUserMedia } from '@/lib/profile-media';
import { getUserPreferences, getViewerRelation, isVisibilityAllowed } from '@/lib/user-preferences';

export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const userId = Number((await params).id);
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: 'Некорректный пользователь.' }, { status: 400 });
    }

    const preferences = await getUserPreferences(userId, prisma);
    const relation = await getViewerRelation(session.user.id, userId, prisma);
    const canSeeMedia = isVisibilityAllowed(preferences.photo_visibility, relation);
    if (!canSeeMedia) {
      return NextResponse.json({ items: [], counts: { all: 0 }, restricted: true }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const posts = await prisma.post.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: 'desc' },
      take: 80,
      include: { author: true },
    });

    const media = collectUserMedia(posts, session.user.id);
    return NextResponse.json({ items: media.items, counts: media.counts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('users/media get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить медиа пользователя.' }, { status: 500 });
  }
}

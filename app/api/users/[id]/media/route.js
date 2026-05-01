import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { collectUserMedia } from '@/lib/profile-media';
import { filterPostsForViewer } from '@/lib/access-control';
import { getUserPreferences, getViewerRelation, isVisibilityAllowed } from '@/lib/user-preferences';
import { buildCreatedBeforeWhere, getNextCreatedAtCursor, parsePositiveInt, PERF_LIMITS } from '@/lib/performance';

export async function GET(request, { params }) {
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
      return NextResponse.json({ items: [], counts: { all: 0, photos: 0, videos: 0, cards: 0 }, restricted: true }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const { searchParams } = new URL(request.url);
    const limit = parsePositiveInt(searchParams.get('limit'), PERF_LIMITS.mediaItems.default, PERF_LIMITS.mediaItems.max);
    const cursorWhere = buildCreatedBeforeWhere(searchParams.get('cursor'));

    const rows = await prisma.post.findMany({
      where: { status: 'visible', authorId: userId, ...cursorWhere },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        authorId: true,
        text: true,
        type: true,
        visibility: true,
        status: true,
        communityId: true,
        payload: true,
        createdAt: true,
        community: true,
        author: true,
      },
    });

    const posts = rows.slice(0, limit);
    const accessiblePosts = await filterPostsForViewer(posts, session.user.id, prisma);
    const media = collectUserMedia(accessiblePosts, session.user.id);
    return NextResponse.json({
      items: media.items,
      counts: media.counts,
      restricted: false,
      page: {
        limit,
        has_more: rows.length > limit,
        next_cursor: rows.length > limit ? getNextCreatedAtCursor(posts, limit) : null,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.warn('users/media fallback enabled', error?.message || error);
    return NextResponse.json({
      items: [],
      counts: { all: 0, photos: 0, videos: 0, cards: 0 },
      restricted: false,
      page: { has_more: false, next_cursor: null },
      degraded: true,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
}

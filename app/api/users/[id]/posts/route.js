import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { serializePostsForViewer } from '@/lib/posts';
import { buildCreatedBeforeWhere, buildPostListInclude, getNextCreatedAtCursor, parsePositiveInt, PERF_LIMITS } from '@/lib/performance';
import { filterPostsForViewer } from '@/lib/access-control';
import { getUserPreferences, getViewerRelation, isVisibilityAllowed } from '@/lib/user-preferences';


export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const { id } = await params;
    const userId = Number(id);
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: 'Некорректный пользователь.' }, { status: 400 });
    }

    const preferences = await getUserPreferences(userId, prisma);
    const relation = await getViewerRelation(session.user.id, userId, prisma);
    const canSeeProfile = isVisibilityAllowed(preferences.profile_visibility, relation);
    if (!canSeeProfile) {
      return NextResponse.json({ posts: [], restricted: true }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const { searchParams } = new URL(request.url);
    const limit = parsePositiveInt(searchParams.get('limit'), PERF_LIMITS.profilePosts.default, PERF_LIMITS.profilePosts.max);
    const cursorWhere = buildCreatedBeforeWhere(searchParams.get('cursor'));

    const rows = await prisma.post.findMany({
      where: {
        status: 'visible',
        authorId: userId,
        communityId: null,
        ...cursorWhere,
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: buildPostListInclude(session.user.id),
    });

    const posts = rows.slice(0, limit);
    const accessiblePosts = await filterPostsForViewer(posts, session.user.id, prisma);

    return NextResponse.json({
      posts: await serializePostsForViewer(accessiblePosts, session.user.id),
      restricted: false,
      page: {
        limit,
        has_more: rows.length > limit,
        next_cursor: rows.length > limit ? getNextCreatedAtCursor(posts, limit) : null,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.warn('users/posts fallback enabled', error?.message || error);
    return NextResponse.json({
      posts: [],
      restricted: false,
      page: { has_more: false, next_cursor: null },
      degraded: true,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
}

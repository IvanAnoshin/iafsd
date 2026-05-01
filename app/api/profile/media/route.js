import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { collectUserMedia, ensureUserMediaSettings, serializeMediaSettings } from '@/lib/profile-media';
import { buildCreatedBeforeWhere, getNextCreatedAtCursor, parsePositiveInt, PERF_LIMITS } from '@/lib/performance';

export async function GET(request) {
  let session = null;

  try {
    session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const { searchParams } = new URL(request.url);
    const limit = parsePositiveInt(searchParams.get('limit'), PERF_LIMITS.mediaItems.default, PERF_LIMITS.mediaItems.max);
    const cursorWhere = buildCreatedBeforeWhere(searchParams.get('cursor'));

    const [settingsRecord, rows] = await Promise.all([
      ensureUserMediaSettings(session.user.id),
      prisma.post.findMany({
        where: { authorId: session.user.id, status: 'visible', ...cursorWhere },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        select: {
          id: true,
          authorId: true,
          text: true,
          type: true,
          payload: true,
          createdAt: true,
          author: true,
        },
      }),
    ]);

    const posts = rows.slice(0, limit);
    const media = collectUserMedia(posts, session.user.id);

    return NextResponse.json({
      settings: serializeMediaSettings(settingsRecord),
      items: media.items,
      counts: media.counts,
      page: {
        limit,
        has_more: rows.length > limit,
        next_cursor: rows.length > limit ? getNextCreatedAtCursor(posts, limit) : null,
      },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.warn('profile/media fallback enabled', error?.message || error);
    if (!session?.user) {
      return NextResponse.json({ error: 'Не удалось загрузить медиа профиля.' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parsePositiveInt(searchParams.get('limit'), PERF_LIMITS.mediaItems.default, PERF_LIMITS.mediaItems.max);
    return NextResponse.json({
      settings: serializeMediaSettings(null),
      items: [],
      counts: { all: 0, photos: 0, videos: 0, cards: 0 },
      page: { limit, has_more: false, next_cursor: null },
      degraded: true,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

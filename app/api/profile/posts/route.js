import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { POST_TEXT_LIMIT, buildPersonalPostPayload, isPostTextTooLong, normalizePostLocation, normalizePostMedia, normalizePostText, normalizePostVisibility, serializePostForViewer, serializePostsForViewer } from '@/lib/posts';
import { buildCreatedBeforeWhere, buildPostListInclude, getNextCreatedAtCursor, parsePositiveInt, PERF_LIMITS } from '@/lib/performance';
import { enforceRateLimit } from '@/lib/anti-abuse';
import { assertMediaReferencesBelongToScope } from '@/lib/media-security';


export async function GET(request) {
  let session = null;

  try {
    session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const { searchParams } = new URL(request.url);
    const limit = parsePositiveInt(searchParams.get('limit'), PERF_LIMITS.profilePosts.default, PERF_LIMITS.profilePosts.max);
    const cursorWhere = buildCreatedBeforeWhere(searchParams.get('cursor'));

    const rows = await prisma.post.findMany({
      where: {
        status: 'visible',
        authorId: session.user.id,
        communityId: null,
        ...cursorWhere,
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: buildPostListInclude(session.user.id),
    });

    const posts = rows.slice(0, limit);

    return NextResponse.json({
      posts: await serializePostsForViewer(posts, session.user.id),
      page: {
        limit,
        has_more: rows.length > limit,
        next_cursor: rows.length > limit ? getNextCreatedAtCursor(posts, limit) : null,
      },
    });
  } catch (error) {
    console.warn('profile/posts fallback enabled', error?.message || error);
    if (!session?.user) {
      return NextResponse.json({ error: 'Не удалось загрузить посты профиля.' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parsePositiveInt(searchParams.get('limit'), PERF_LIMITS.profilePosts.default, PERF_LIMITS.profilePosts.max);
    return NextResponse.json({
      posts: [],
      page: { limit, has_more: false, next_cursor: null },
      degraded: true,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export async function POST(request) {
  let auditSession = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    auditSession = session;
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const postLimit = await enforceRateLimit({ request, policy: 'post_create', actorUserId: session.user.id });
    if (postLimit) return postLimit;

    const body = await request.json();
    if (isPostTextTooLong(body.text)) {
      return NextResponse.json({ error: 'Текст поста не должен превышать ' + POST_TEXT_LIMIT + ' символов.' }, { status: 400 });
    }
    const text = normalizePostText(body.text);
    const location = normalizePostLocation(body.location);
    const media = normalizePostMedia(body.media, 10);
    await assertMediaReferencesBelongToScope({
      db: prisma,
      media,
      ownerUserId: session.user.id,
      allowedSurfaces: ['post'],
      allowedScopeIds: [session.user.id],
      label: 'медиа поста',
    });
    const visibility = normalizePostVisibility(body.visibility, 'public');

    if (!text && !media.length) {
      return NextResponse.json({ error: 'Введите текст поста или добавьте медиа.' }, { status: 400 });
    }

    const created = await prisma.post.create({
      data: {
        authorId: session.user.id,
        text: text || '',
        type: media.length ? 'gallery' : 'text',
        visibility,
        location,
        payload: buildPersonalPostPayload({ media, source: 'profile', extra: { aggregatedIntoFeed: true } }),
      },
      include: buildPostListInclude(session.user.id, { commentsTake: 8 }),
    });

    await writeAuditLog({
      request,
      session,
      action: 'profile.post.create',
      entityType: 'post',
      entityId: created.id,
      metadata: {
        length: (text || '').length,
        location,
        visibility,
      },
    });

    return NextResponse.json({
      message: 'Пост опубликован в профиле.',
      post: await serializePostForViewer(created, session.user.id),
    }, { status: 201 });
  } catch (error) {
    console.error('profile/posts create failed', error);
    await writeAuditLog({
      request,
      session: auditSession,
      action: 'profile.post.create',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: error?.status && error.status < 500 ? error.message : 'Не удалось опубликовать пост.' }, { status: error?.status || 500 });
  }
}

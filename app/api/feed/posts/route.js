import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/anti-abuse';
import { assertMediaReferencesBelongToScope } from '@/lib/media-security';
import { ensureUserNotRestricted } from '@/lib/moderation-enforcement';
import { buildPersonalPostPayload, normalizePostLocation, normalizePostMedia, normalizePostText, normalizePostVisibility, serializePostForViewer } from '@/lib/posts';
import { buildPostListInclude } from '@/lib/performance';


export async function POST(request) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    await ensureUserNotRestricted(session.user.id, 'posting');

    const postLimit = await enforceRateLimit({ request, policy: 'post_create', actorUserId: session.user.id });
    if (postLimit) return postLimit;

    const body = await request.json().catch(() => ({}));
    const text = normalizePostText(body.text, 1200);
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
    const location = normalizePostLocation(body.location);

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
        payload: buildPersonalPostPayload({ media, source: 'feed' }),
      },
      include: buildPostListInclude(session.user.id, { commentsTake: 8 }),
    });

    await writeAuditLog({
      request,
      session,
      action: 'feed.post.create',
      entityType: 'post',
      entityId: created.id,
      metadata: { visibility, mediaCount: media.length, length: (text || '').length },
    }).catch(() => null);

    return NextResponse.json({
      message: 'Пост опубликован.',
      post: await serializePostForViewer({
        ...created,
        payload: { ...(created.payload || {}), feedChannel: 'following' },
      }, session.user.id),
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('feed/posts create failed', error);
    await writeAuditLog({ request, session, action: 'feed.post.create', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    return NextResponse.json({ error: error?.status && error.status < 500 ? error.message : 'Не удалось опубликовать пост.' }, { status: error?.status || 500 });
  }
}

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { canViewerAccessPost, normalizePostLocation, normalizePostMedia, normalizePostText, normalizePostVisibility, serializePostForViewer } from '@/lib/posts';
import { buildPostListInclude } from '@/lib/performance';


function safePostPayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function resolvePostId(params) {
  const { postId } = await params;
  const postIdNum = Number(postId);
  if (!Number.isInteger(postIdNum) || postIdNum <= 0) return null;
  return postIdNum;
}

export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const postIdNum = await resolvePostId(params);
    if (!postIdNum) return NextResponse.json({ error: 'Некорректный пост.' }, { status: 400 });

    const post = await prisma.post.findUnique({
      where: { id: postIdNum },
      include: buildPostListInclude(session.user.id, { commentsTake: 8 }),
    });

    if (!post) return NextResponse.json({ error: 'Пост не найден.' }, { status: 404 });

    const canView = await canViewerAccessPost(post, session.user.id);
    if (!canView) return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });

    return NextResponse.json({
      post: await serializePostForViewer(post, session.user.id),
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('feed/post get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить публикацию.' }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  let session = null;
  let postIdNum = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    postIdNum = await resolvePostId(params);
    if (!postIdNum) return NextResponse.json({ error: 'Некорректный пост.' }, { status: 400 });

    const existing = await prisma.post.findUnique({ where: { id: postIdNum } });
    if (!existing || existing.deletedAt || existing.status === 'deleted') {
      return NextResponse.json({ error: 'Пост не найден.' }, { status: 404 });
    }
    if (existing.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Редактировать можно только свои публикации.' }, { status: 403 });
    }
    if (existing.communityId) {
      return NextResponse.json({ error: 'Посты сообществ редактируются на странице сообщества.' }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const text = normalizePostText(body.text, 1200);
    const media = body.media === undefined ? null : normalizePostMedia(body.media, 10);
    const visibility = normalizePostVisibility(body.visibility, existing.visibility || 'public');
    const location = body.location === undefined ? existing.location : normalizePostLocation(body.location);
    const existingPayload = existing.payload && typeof existing.payload === 'object' ? existing.payload : {};
    const nextMedia = media === null ? (Array.isArray(existingPayload.media) ? existingPayload.media : []) : media;

    if (!text && !nextMedia.length) {
      return NextResponse.json({ error: 'Введите текст поста или добавьте медиа.' }, { status: 400 });
    }

    const updated = await prisma.post.update({
      where: { id: postIdNum },
      data: {
        text: text || '',
        type: nextMedia.length ? 'gallery' : 'text',
        visibility,
        location,
        payload: {
          ...existingPayload,
          source: existingPayload.source || 'feed',
          surface: existingPayload.surface || 'feed',
          ...(nextMedia.length ? { media: nextMedia } : { media: [] }),
        },
      },
      include: buildPostListInclude(session.user.id, { commentsTake: 8 }),
    });

    await writeAuditLog({
      request,
      session,
      action: 'feed.post.update',
      entityType: 'post',
      entityId: updated.id,
      metadata: { visibility, mediaCount: nextMedia.length },
    }).catch(() => null);

    return NextResponse.json({
      message: 'Пост обновлён.',
      post: await serializePostForViewer(updated, session.user.id),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('feed/post update failed', error);
    await writeAuditLog({ request, session, action: 'feed.post.update', entityType: 'post', entityId: postIdNum, status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    return NextResponse.json({ error: 'Не удалось обновить пост.' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  let session = null;
  let postIdNum = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    postIdNum = await resolvePostId(params);
    if (!postIdNum) return NextResponse.json({ error: 'Некорректный пост.' }, { status: 400 });

    const existing = await prisma.post.findUnique({ where: { id: postIdNum } });
    if (!existing || existing.deletedAt || existing.status === 'deleted') {
      return NextResponse.json({ error: 'Пост не найден.' }, { status: 404 });
    }
    if (existing.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Удалить можно только свои публикации.' }, { status: 403 });
    }
    if (existing.communityId) {
      return NextResponse.json({ error: 'Посты сообществ удаляются на странице сообщества.' }, { status: 409 });
    }

    await prisma.post.update({
      where: { id: postIdNum },
      data: {
        status: 'deleted',
        deletedAt: new Date(),
      },
    });

    if (existing.repostOfId) {
      const original = await prisma.post.findUnique({ where: { id: Number(existing.repostOfId) }, select: { id: true, payload: true } }).catch(() => null);
      if (original) {
        const originalPayload = safePostPayload(original.payload);
        await prisma.post.update({
          where: { id: original.id },
          data: {
            payload: {
              ...originalPayload,
              profile_reposts: Math.max(0, (Number(originalPayload.profile_reposts || originalPayload.profileReposts || 0) || 0) - 1),
            },
          },
        }).catch(() => null);
      }
    }

    await writeAuditLog({
      request,
      session,
      action: 'feed.post.delete',
      entityType: 'post',
      entityId: postIdNum,
      metadata: { type: existing.type },
    }).catch(() => null);

    return NextResponse.json({ message: 'Пост удалён.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('feed/post delete failed', error);
    await writeAuditLog({ request, session, action: 'feed.post.delete', entityType: 'post', entityId: postIdNum, status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    return NextResponse.json({ error: 'Не удалось удалить пост.' }, { status: 500 });
  }
}

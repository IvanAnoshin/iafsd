import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { canViewerAccessPost, serializePostForViewer } from '@/lib/posts';
import { commentInclude, loadSerializedComments, postWithCommentsInclude, serializeComment } from '@/lib/comments';
import { enforceRateLimit } from '@/lib/anti-abuse';
import { ensureUserNotRestricted } from '@/lib/moderation-enforcement';

async function loadSerializedPost(postId, currentUserId) {
  const updatedPost = await prisma.post.findUnique({
    where: { id: postId },
    include: postWithCommentsInclude,
  });
  return updatedPost ? serializePostForViewer(updatedPost, currentUserId) : null;
}

async function resolveReplyTarget(postId, replyToCommentId) {
  const normalizedId = Number(replyToCommentId || 0);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) return null;

  const replyTarget = await prisma.comment.findUnique({
    where: { id: normalizedId },
    include: commentInclude,
  });

  if (!replyTarget || Number(replyTarget.postId) !== Number(postId)) {
    throw new Error('Комментарий для ответа не найден.');
  }

  if (String(replyTarget.status || 'visible') !== 'visible') {
    throw new Error('Нельзя ответить на комментарий, который уже скрыт из обсуждения.');
  }

  return replyTarget;
}

export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);

    const { id } = await params;
    const postId = Number(id);
    if (!Number.isFinite(postId)) {
      return NextResponse.json({ error: 'Некорректный пост.' }, { status: 400 });
    }

    const post = await prisma.post.findUnique({ where: { id: postId }, include: { community: true } });
    if (!post) {
      return NextResponse.json({ error: 'Пост не найден.' }, { status: 404 });
    }
    if (!(await canViewerAccessPost(post, session.user.id))) {
      return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
    }

    const comments = await loadSerializedComments(postId, session.user.id);
    return NextResponse.json({ comments, comments_count: comments.length });
  } catch (error) {
    console.error('post/comments get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить комментарии.' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    await ensureUserNotRestricted(session.user.id, 'posting');

    const commentLimit = await enforceRateLimit({ request, policy: 'comment_create', actorUserId: session.user.id });
    if (commentLimit) return commentLimit;

    const { id } = await params;
    const postId = Number(id);
    if (!Number.isFinite(postId)) {
      return NextResponse.json({ error: 'Некорректный пост.' }, { status: 400 });
    }

    const body = await request.json();
    const text = String(body.text || '').trim().slice(0, 1000);
    if (!text) {
      return NextResponse.json({ error: 'Введите комментарий.' }, { status: 400 });
    }

    const post = await prisma.post.findUnique({ where: { id: postId }, include: { community: true } });
    if (!post) {
      return NextResponse.json({ error: 'Пост не найден.' }, { status: 404 });
    }
    if (!(await canViewerAccessPost(post, session.user.id))) {
      return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
    }

    const replyTarget = await resolveReplyTarget(postId, body.reply_to_comment_id);

    const created = await prisma.comment.create({
      data: {
        postId,
        authorId: session.user.id,
        text,
        replyToCommentId: replyTarget?.id || null,
      },
      include: commentInclude,
    });

    const updatedPost = await loadSerializedPost(postId, session.user.id);
    const serializedComment = serializeComment({ ...created, votes: [] }, session.user.id);

    if (replyTarget && Number(replyTarget.authorId) !== Number(session.user.id)) {
      await createNotification({
        userId: replyTarget.authorId,
        actorUserId: session.user.id,
        type: 'comment_reply',
        title: 'Новый ответ на комментарий',
        body: `${session.user.firstName} ${session.user.lastName}`.trim() + ' ответил(а) на ваш комментарий.',
        targetLabel: String(replyTarget.text || '').trim().slice(0, 80) || 'Откройте публикацию, чтобы посмотреть ответ.',
        entityType: 'comment',
        entityId: replyTarget.id,
        payload: { postId: post.id, commentId: created.id, replyToCommentId: replyTarget.id },
      });
    }

    if (Number(post.authorId) !== Number(session.user.id) && Number(post.authorId) !== Number(replyTarget?.authorId || 0)) {
      await createNotification({
        userId: post.authorId,
        actorUserId: session.user.id,
        type: 'comment',
        title: 'Новый комментарий к публикации',
        body: `${session.user.firstName} ${session.user.lastName}`.trim() + (replyTarget ? ' оставил(а) ответ в обсуждении вашей публикации.' : ' прокомментировал(а) вашу публикацию.'),
        targetLabel: String(post.text || '').trim().slice(0, 80) || 'Откройте публикацию, чтобы посмотреть комментарий.',
        entityType: 'post',
        entityId: post.id,
        payload: { postId: post.id, commentId: created.id, replyToCommentId: replyTarget?.id || null },
      });
    }

    await writeAuditLog({
      request,
      session,
      action: 'comment.create',
      entityType: 'comment',
      entityId: created.id,
      metadata: { postId, length: text.length, surface: 'post_comments_endpoint', replyToCommentId: replyTarget?.id || null },
    });

    return NextResponse.json({
      post: updatedPost,
      comment: serializedComment,
      comments_count: updatedPost?.stats?.comments ?? 0,
      message: 'Комментарий добавлен.',
    }, { status: 201 });
  } catch (error) {
    console.error('post/comments create failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'comment.create',
      entityType: 'comment',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error', surface: 'post_comments_endpoint' },
    });
    return NextResponse.json({ error: error?.status && error.status < 500 ? error.message : 'Не удалось добавить комментарий.' }, { status: error?.status || 500 });
  }
}

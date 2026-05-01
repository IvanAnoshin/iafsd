import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { attachCommentViewerFlags, attachCommentVotes, commentInclude, serializeComment } from '@/lib/comments';

export async function POST(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const { id } = await params;
    const commentId = Number(id);
    if (!Number.isFinite(commentId)) {
      return NextResponse.json({ error: 'Некорректный комментарий.' }, { status: 400 });
    }

    if (!prisma.commentVote) {
      return NextResponse.json({ error: 'Голоса по комментариям станут доступны после обновления базы данных.' }, { status: 503 });
    }

    const body = await request.json();
    const value = Number(body.value);
    if (![1, -1, 0].includes(value)) {
      return NextResponse.json({ error: 'Некорректное значение голоса.' }, { status: 400 });
    }

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) {
      return NextResponse.json({ error: 'Комментарий не найден.' }, { status: 404 });
    }

    if (String(comment.status || 'visible') !== 'visible') {
      return NextResponse.json({ error: 'Этот комментарий больше нельзя оценивать.' }, { status: 409 });
    }

    const existing = await prisma.commentVote.findUnique({
      where: { commentId_userId: { commentId, userId: session.user.id } },
    });

    await prisma.$transaction(async (tx) => {
      if (value === 0) {
        if (existing) {
          await tx.commentVote.delete({ where: { id: existing.id } });
        }
        return;
      }

      if (existing) {
        await tx.commentVote.update({ where: { id: existing.id }, data: { value } });
        return;
      }

      await tx.commentVote.create({
        data: {
          commentId,
          userId: session.user.id,
          value,
        },
      });
    });

    if (value === 1 && Number(existing?.value || 0) !== 1 && Number(comment.authorId) !== Number(session.user.id)) {
      await createNotification({
        userId: comment.authorId,
        actorUserId: session.user.id,
        type: 'comment_like',
        title: 'Комментарий оценили',
        body: `${session.user.firstName} ${session.user.lastName}`.trim() + ' поставил(а) плюс вашему комментарию.',
        targetLabel: String(comment.text || '').trim().slice(0, 80) || 'Откройте комментарий, чтобы посмотреть реакцию.',
        entityType: 'comment',
        entityId: comment.id,
        payload: { commentId: comment.id, postId: comment.postId },
      });
    }

    const updated = await prisma.comment.findUnique({
      where: { id: commentId },
      include: commentInclude,
    });
    let [hydrated] = await attachCommentVotes([updated]);
    [hydrated] = await attachCommentViewerFlags([hydrated], session.user.id);

    await writeAuditLog({
      request,
      session,
      action: 'comment.vote',
      entityType: 'comment',
      entityId: commentId,
      metadata: { value, postId: comment.postId },
    });

    return NextResponse.json({ comment: serializeComment(hydrated, session.user.id) });
  } catch (error) {
    console.error('comment/vote failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'comment.vote',
      entityType: 'comment',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: 'Не удалось обновить голос комментария.' }, { status: 500 });
  }
}

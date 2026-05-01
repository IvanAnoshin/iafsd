import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { attachCommentViewerFlags, attachCommentVotes, commentInclude, serializeComment } from '@/lib/comments';

export async function PUT(request, { params }) {
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

    const body = await request.json();
    const text = String(body.text || '').trim().slice(0, 1000);
    if (!text) {
      return NextResponse.json({ error: 'Введите текст комментария.' }, { status: 400 });
    }

    const existing = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!existing) {
      return NextResponse.json({ error: 'Комментарий не найден.' }, { status: 404 });
    }

    if (existing.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Можно редактировать только свои комментарии.' }, { status: 403 });
    }

    if (String(existing.status || 'visible') !== 'visible') {
      return NextResponse.json({ error: 'Этот комментарий больше нельзя редактировать.' }, { status: 409 });
    }

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: { text },
      include: commentInclude,
    });
    let [hydrated] = await attachCommentVotes([updated]);
    [hydrated] = await attachCommentViewerFlags([hydrated], session.user.id);

    await writeAuditLog({
      request,
      session,
      action: 'comment.update',
      entityType: 'comment',
      entityId: commentId,
      metadata: { postId: existing.postId, length: text.length },
    });

    return NextResponse.json({ comment: serializeComment(hydrated, session.user.id), message: 'Комментарий обновлён.' });
  } catch (error) {
    console.error('comment/update failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'comment.update',
      entityType: 'comment',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: 'Не удалось обновить комментарий.' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
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

    const existing = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!existing) {
      return NextResponse.json({ error: 'Комментарий не найден.' }, { status: 404 });
    }

    if (existing.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Можно удалять только свои комментарии.' }, { status: 403 });
    }

    const nextStatus = String(existing.status || 'visible');
    if (nextStatus !== 'visible') {
      const current = await prisma.comment.findUnique({ where: { id: commentId }, include: commentInclude });
      let [hydrated] = await attachCommentVotes([current]);
      [hydrated] = await attachCommentViewerFlags([hydrated], session.user.id);
      return NextResponse.json({
        ok: true,
        comment: serializeComment(hydrated, session.user.id),
        message: 'Комментарий уже убран из обсуждения.',
      });
    }

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: {
        status: 'deleted',
        moderationReason: 'removed_by_author',
        deletedAt: new Date(),
        text: '',
      },
      include: commentInclude,
    });
    let [hydrated] = await attachCommentVotes([updated]);
    [hydrated] = await attachCommentViewerFlags([hydrated], session.user.id);

    await writeAuditLog({
      request,
      session,
      action: 'comment.delete',
      entityType: 'comment',
      entityId: commentId,
      metadata: { postId: existing.postId, mode: 'soft_delete' },
    });

    return NextResponse.json({
      ok: true,
      comment: serializeComment(hydrated, session.user.id),
      post_id: existing.postId,
      message: 'Комментарий удалён.',
    });
  } catch (error) {
    console.error('comment/delete failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'comment.delete',
      entityType: 'comment',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: 'Не удалось удалить комментарий.' }, { status: 500 });
  }
}

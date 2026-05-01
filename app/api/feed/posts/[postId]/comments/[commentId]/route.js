import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession } from '@/lib/auth';

export async function DELETE(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    const postIdNum = Number(params.postId);
    const commentIdNum = Number(params.commentId);
    if (!Number.isFinite(postIdNum) || !Number.isFinite(commentIdNum)) {
      return NextResponse.json({ error: 'Некорректный комментарий.' }, { status: 400 });
    }

    const comment = await prisma.comment.findUnique({ where: { id: commentIdNum } });
    if (!comment || comment.postId !== postIdNum) {
      return NextResponse.json({ error: 'Комментарий не найден.' }, { status: 404 });
    }

    if (comment.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Удалять можно только свои комментарии.' }, { status: 403 });
    }

    await prisma.comment.delete({ where: { id: commentIdNum } });
    const total = await prisma.comment.count({ where: { postId: postIdNum } });

    return NextResponse.json({ ok: true, comments_count: total });
  } catch (error) {
    console.error('feed/comment-delete failed', error);
    return NextResponse.json({ error: 'Не удалось удалить комментарий.' }, { status: 500 });
  }
}

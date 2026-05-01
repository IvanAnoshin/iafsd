import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, verifyCsrf } from '@/lib/auth';
import { serializePostForViewer } from '@/lib/posts';

export async function POST(request, { params }) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    const { postId } = await params;
    const postIdNum = Number(postId);
    if (!Number.isFinite(postIdNum)) {
      return NextResponse.json({ error: 'Некорректный пост.' }, { status: 400 });
    }

    const body = await request.json();
    const value = Number(body.value);
    if (![1, -1, 0].includes(value)) {
      return NextResponse.json({ error: 'Некорректное значение голоса.' }, { status: 400 });
    }

    const post = await prisma.post.findUnique({ where: { id: postIdNum } });
    if (!post) {
      return NextResponse.json({ error: 'Пост не найден.' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.postVote.findUnique({
        where: { postId_userId: { postId: postIdNum, userId: session.user.id } },
      });

      if (value === 0) {
        if (existing) {
          await tx.postVote.delete({ where: { id: existing.id } });
        }
        return;
      }

      if (existing) {
        await tx.postVote.update({ where: { id: existing.id }, data: { value } });
        return;
      }

      await tx.postVote.create({ data: { postId: postIdNum, userId: session.user.id, value } });
    });

    const updatedPost = await prisma.post.findUnique({
      where: { id: postIdNum },
      include: {
        author: true,
        comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
        votes: true,
        saves: true,
      },
    });

    return NextResponse.json({ post: await serializePostForViewer(updatedPost, session.user.id) });
  } catch (error) {
    console.error('feed/vote failed', error);
    return NextResponse.json({ error: 'Не удалось обновить голос.' }, { status: 500 });
  }
}

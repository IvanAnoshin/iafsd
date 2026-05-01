import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { serializePostForViewer } from '@/lib/posts';

export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const { id } = await params;
    const postId = Number(id);
    if (!Number.isFinite(postId)) {
      return NextResponse.json({ error: 'Некорректный пост.' }, { status: 400 });
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        author: true,
        comments: {
          include: { author: true },
          orderBy: { createdAt: 'desc' },
        },
        votes: true,
        saves: true,
      },
    });

    if (!post) {
      return NextResponse.json({ error: 'Пост не найден.' }, { status: 404 });
    }

    return NextResponse.json({ post: await serializePostForViewer(post, session.user.id) });
  } catch (error) {
    console.error('post/get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить пост.' }, { status: 500 });
  }
}

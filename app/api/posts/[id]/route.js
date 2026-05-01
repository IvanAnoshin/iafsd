import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { canViewerAccessPost, serializePostForViewer } from '@/lib/posts';
import { buildPostListInclude } from '@/lib/performance';

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
      include: buildPostListInclude(session.user.id, { commentsTake: 8 }),
    });

    if (!post) {
      return NextResponse.json({ error: 'Пост не найден.' }, { status: 404 });
    }

    const canView = await canViewerAccessPost(post, session.user.id);
    if (!canView) {
      return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
    }

    return NextResponse.json({ post: await serializePostForViewer(post, session.user.id) });
  } catch (error) {
    console.error('post/get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить пост.' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, verifyCsrf } from '@/lib/auth';
import { canViewerAccessPost, serializePostForViewer } from '@/lib/posts';
import { buildPostListInclude } from '@/lib/performance';

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

    const post = await prisma.post.findUnique({ where: { id: postIdNum }, include: { community: true } });
    if (!post) return NextResponse.json({ error: 'Пост не найден.' }, { status: 404 });
    if (!(await canViewerAccessPost(post, session.user.id))) {
      return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
    }

    const existing = await prisma.savedPost.findUnique({
      where: { postId_userId: { postId: postIdNum, userId: session.user.id } },
    });

    if (existing) {
      await prisma.savedPost.delete({ where: { id: existing.id } });
    } else {
      await prisma.savedPost.create({ data: { postId: postIdNum, userId: session.user.id } });
    }

    const updatedPost = await prisma.post.findUnique({
      where: { id: postIdNum },
      include: buildPostListInclude(session.user.id, { commentsTake: 8 }),
    });

    return NextResponse.json({ post: await serializePostForViewer(updatedPost, session.user.id) });
  } catch (error) {
    console.error('feed/save failed', error);
    return NextResponse.json({ error: 'Не удалось обновить сохранение.' }, { status: 500 });
  }
}

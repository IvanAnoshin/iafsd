import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { serializePostsForViewer } from '@/lib/posts';
import { getUserPreferences, getViewerRelation, isVisibilityAllowed } from '@/lib/user-preferences';

const postInclude = {
  author: true,
  comments: {
    include: { author: true },
    orderBy: { createdAt: 'desc' },
  },
  votes: true,
  saves: true,
};

export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const { id } = await params;
    const userId = Number(id);
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: 'Некорректный пользователь.' }, { status: 400 });
    }

    const preferences = await getUserPreferences(userId, prisma);
    const relation = await getViewerRelation(session.user.id, userId, prisma);
    const canSeeProfile = isVisibilityAllowed(preferences.profile_visibility, relation);
    if (!canSeeProfile) {
      return NextResponse.json({ posts: [], restricted: true }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const posts = await prisma.post.findMany({
      where: {
        authorId: userId,
        type: 'text',
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: postInclude,
    });

    return NextResponse.json({
      posts: await serializePostsForViewer(posts, session.user.id),
    });
  } catch (error) {
    console.error('users/posts get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить посты пользователя.' }, { status: 500 });
  }
}

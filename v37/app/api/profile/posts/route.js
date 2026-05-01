import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { normalizePostText, serializePostForViewer, serializePostsForViewer } from '@/lib/posts';

const postInclude = {
  author: true,
  comments: {
    include: { author: true },
    orderBy: { createdAt: 'desc' },
  },
  votes: true,
  saves: true,
};

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const posts = await prisma.post.findMany({
      where: {
        authorId: session.user.id,
        type: 'text',
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: postInclude,
    });

    return NextResponse.json({
      posts: await serializePostsForViewer(posts, session.user.id),
    });
  } catch (error) {
    console.error('profile/posts get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить посты профиля.' }, { status: 500 });
  }
}

export async function POST(request) {
  let auditSession = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    auditSession = session;
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const body = await request.json();
    const text = normalizePostText(body.text, 1200);
    const location = String(body.location || '').trim().slice(0, 120) || null;

    if (!text) {
      return NextResponse.json({ error: 'Введите текст поста.' }, { status: 400 });
    }

    const created = await prisma.post.create({
      data: {
        authorId: session.user.id,
        text,
        type: 'text',
        location,
        payload: {
          source: 'profile',
          surface: 'profile',
          aggregatedIntoFeed: false,
        },
      },
      include: {
        author: true,
        comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
        votes: true,
        saves: true,
      },
    });

    await writeAuditLog({
      request,
      session,
      action: 'profile.post.create',
      entityType: 'post',
      entityId: created.id,
      metadata: {
        length: text.length,
        location,
      },
    });

    return NextResponse.json({
      message: 'Пост опубликован в профиле.',
      post: await serializePostForViewer(created, session.user.id),
    }, { status: 201 });
  } catch (error) {
    console.error('profile/posts create failed', error);
    await writeAuditLog({
      request,
      session: auditSession,
      action: 'profile.post.create',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: 'Не удалось опубликовать пост.' }, { status: 500 });
  }
}

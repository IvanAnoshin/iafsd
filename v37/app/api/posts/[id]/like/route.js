import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { serializePostForViewer } from '@/lib/posts';

const postInclude = {
  author: true,
  comments: {
    include: { author: true },
    orderBy: { createdAt: 'desc' },
  },
  votes: true,
  saves: true,
};

async function loadSerializedPost(postId, userId) {
  const updatedPost = await prisma.post.findUnique({
    where: { id: postId },
    include: postInclude,
  });
  return updatedPost ? serializePostForViewer(updatedPost, userId) : null;
}

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
    const postId = Number(id);
    if (!Number.isFinite(postId)) {
      return NextResponse.json({ error: 'Некорректный пост.' }, { status: 400 });
    }

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      return NextResponse.json({ error: 'Пост не найден.' }, { status: 404 });
    }

    const existing = await prisma.postVote.findUnique({
      where: { postId_userId: { postId, userId: session.user.id } },
    });

    await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.postVote.update({
          where: { id: existing.id },
          data: { value: 1 },
        });
        return;
      }

      await tx.postVote.create({
        data: {
          postId,
          userId: session.user.id,
          value: 1,
        },
      });
    });

    if (Number(post.authorId) !== Number(session.user.id) && Number(existing?.value || 0) !== 1) {
      await createNotification({
        userId: post.authorId,
        actorUserId: session.user.id,
        type: 'like',
        title: 'Новый лайк',
        body: `${session.user.firstName} ${session.user.lastName}`.trim() + ' отметил(а), что ему нравится ваша публикация.',
        targetLabel: String(post.text || '').trim().slice(0, 80) || 'Откройте публикацию, чтобы посмотреть реакцию.',
        entityType: 'post',
        entityId: post.id,
        payload: { postId: post.id },
      });
    }

    const serialized = await loadSerializedPost(postId, session.user.id);

    await writeAuditLog({
      request,
      session,
      action: 'post.like',
      entityType: 'post',
      entityId: postId,
      metadata: { surface: 'post_like_endpoint' },
    });

    return NextResponse.json({ post: serialized, message: 'Пост отмечен как понравившийся.' });
  } catch (error) {
    console.error('post/like failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'post.like',
      entityType: 'post',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: 'Не удалось поставить лайк.' }, { status: 500 });
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
    const postId = Number(id);
    if (!Number.isFinite(postId)) {
      return NextResponse.json({ error: 'Некорректный пост.' }, { status: 400 });
    }

    const existing = await prisma.postVote.findUnique({
      where: { postId_userId: { postId, userId: session.user.id } },
    });

    if (existing && Number(existing.value) > 0) {
      await prisma.postVote.delete({ where: { id: existing.id } });
    }

    const serialized = await loadSerializedPost(postId, session.user.id);

    await writeAuditLog({
      request,
      session,
      action: 'post.unlike',
      entityType: 'post',
      entityId: postId,
      metadata: { surface: 'post_like_endpoint' },
    });

    return NextResponse.json({ post: serialized, message: 'Лайк снят.' });
  } catch (error) {
    console.error('post/unlike failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'post.unlike',
      entityType: 'post',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: 'Не удалось снять лайк.' }, { status: 500 });
  }
}

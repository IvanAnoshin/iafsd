import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { deletePostUpload } from '@/lib/post-media';

function safePostPayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export async function DELETE(request, { params }) {
  let auditSession = null;
  let postIdNum = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    auditSession = session;
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const { postId } = await params;
    postIdNum = Number(postId);
    if (!Number.isFinite(postIdNum)) {
      return NextResponse.json({ error: 'Некорректный пост.' }, { status: 400 });
    }

    const post = await prisma.post.findUnique({ where: { id: postIdNum } });
    if (!post || post.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Пост не найден.' }, { status: 404 });
    }

    const payload = post.payload && typeof post.payload === 'object' ? post.payload : {};
    const media = Array.isArray(payload.media) ? payload.media : [];

    await prisma.post.delete({ where: { id: postIdNum } });

    if (post.repostOfId) {
      const original = await prisma.post.findUnique({ where: { id: Number(post.repostOfId) }, select: { id: true, payload: true } }).catch(() => null);
      if (original) {
        const originalPayload = safePostPayload(original.payload);
        await prisma.post.update({
          where: { id: original.id },
          data: {
            payload: {
              ...originalPayload,
              profile_reposts: Math.max(0, (Number(originalPayload.profile_reposts || originalPayload.profileReposts || 0) || 0) - 1),
            },
          },
        }).catch(() => null);
      }
    }

    for (const item of media) {
      if (!item?.url && !item?.storageKey) continue;
      await deletePostUpload({ url: item.url, storageKey: item.storageKey || item.storage_key || null, userId: session.user.id }).catch(() => null);
    }

    await writeAuditLog({
      request,
      session,
      action: 'profile.post.delete',
      entityType: 'post',
      entityId: postIdNum,
      metadata: { type: post.type, mediaCount: media.length },
    });

    return NextResponse.json({ message: 'Пост удалён.' });
  } catch (error) {
    console.error('profile/posts delete failed', error);
    await writeAuditLog({
      request,
      session: auditSession,
      action: 'profile.post.delete',
      entityType: 'post',
      entityId: postIdNum,
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: 'Не удалось удалить пост.' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';

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

    await prisma.post.delete({ where: { id: postIdNum } });

    await writeAuditLog({
      request,
      session,
      action: 'profile.post.delete',
      entityType: 'post',
      entityId: postIdNum,
      metadata: { type: post.type },
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

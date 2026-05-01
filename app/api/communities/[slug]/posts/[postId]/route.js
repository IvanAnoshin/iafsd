import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { moderateCommunityPost } from '@/lib/communities';

export async function PATCH(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const { slug, postId } = await params;
    const payload = await request.json().catch(() => ({}));
    const post = await moderateCommunityPost(slug, postId, session.user.id, payload?.action, payload || {});

    await writeAuditLog({
      request,
      session,
      action: 'community.post.moderate',
      entityType: 'post',
      entityId: String(postId),
      metadata: { slug, moderation_action: payload?.action || null },
    }).catch(() => null);

    return NextResponse.json({ post, message: 'Действие с постом выполнено.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/post moderate failed', error);
    await writeAuditLog({ request, session, action: 'community.post.moderate', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось выполнить действие с постом.' : error.message }, { status });
  }
}

export async function DELETE(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const { slug, postId } = await params;
    const post = await moderateCommunityPost(slug, postId, session.user.id, 'delete', { reason: 'Удалено модерацией сообщества' });

    await writeAuditLog({
      request,
      session,
      action: 'community.post.delete',
      entityType: 'post',
      entityId: String(postId),
      metadata: { slug },
    }).catch(() => null);

    return NextResponse.json({ post, message: 'Пост удалён из сообщества.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/post delete failed', error);
    await writeAuditLog({ request, session, action: 'community.post.delete', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось удалить пост.' : error.message }, { status });
  }
}

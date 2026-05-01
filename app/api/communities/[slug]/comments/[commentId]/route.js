import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { moderateCommunityComment } from '@/lib/communities';

export async function PATCH(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const { slug, commentId } = await params;
    const payload = await request.json().catch(() => ({}));
    const comment = await moderateCommunityComment(slug, commentId, session.user.id, payload?.action, payload || {});

    await writeAuditLog({
      request,
      session,
      action: 'community.comment.moderate',
      entityType: 'comment',
      entityId: String(commentId),
      metadata: { slug, moderation_action: payload?.action || null },
    }).catch(() => null);

    return NextResponse.json({ comment_id: comment.id, status: comment.status, message: 'Действие с комментарием выполнено.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/comment moderate failed', error);
    await writeAuditLog({ request, session, action: 'community.comment.moderate', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось выполнить действие с комментарием.' : error.message }, { status });
  }
}

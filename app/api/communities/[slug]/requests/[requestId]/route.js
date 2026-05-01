import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { communitySerializers, reviewJoinRequest } from '@/lib/communities';

export async function PATCH(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const { slug, requestId } = await params;
    const payload = await request.json().catch(() => ({}));
    const updated = await reviewJoinRequest(slug, requestId, session.user.id, payload?.decision || payload?.status);

    await writeAuditLog({
      request,
      session,
      action: 'community.join_request.review',
      entityType: 'community_join_request',
      entityId: String(updated.id),
      metadata: { decision: updated.status, slug },
    }).catch(() => null);

    return NextResponse.json({ request: communitySerializers.serializeJoinRequest(updated) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/request review failed', error);
    await writeAuditLog({ request, session, action: 'community.join_request.review', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось обработать заявку.' : error.message }, { status });
  }
}

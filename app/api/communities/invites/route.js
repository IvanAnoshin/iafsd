import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { acceptCommunityInvite, getCommunityInvitePreview } from '@/lib/communities';
import { enforceRateLimit, getClientIp } from '@/lib/anti-abuse';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const inviteCheckLimit = await enforceRateLimit({ request, policy: 'community_invite_check', actorUserId: session.user.id, subject: `invite-code:${session.user.id}:${getClientIp(request)}` });
    if (inviteCheckLimit) return inviteCheckLimit;
    const { searchParams } = new URL(request.url);
    const preview = await getCommunityInvitePreview(searchParams.get('code') || '', session.user.id);
    return NextResponse.json(preview, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/invite preview failed', error);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось проверить invite-код.' : error.message }, { status });
  }
}

export async function POST(request) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const inviteAcceptLimit = await enforceRateLimit({ request, policy: 'community_join', actorUserId: session.user.id });
    if (inviteAcceptLimit) return inviteAcceptLimit;
    const payload = await request.json().catch(() => ({}));
    const community = await acceptCommunityInvite(payload?.code || '', session.user.id);
    await writeAuditLog({
      request,
      session,
      action: 'community.invite.accept',
      entityType: 'community',
      entityId: String(community.id),
      metadata: { slug: community.slug },
    }).catch(() => null);
    return NextResponse.json({ community }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/invite accept failed', error);
    await writeAuditLog({ request, session, action: 'community.invite.accept', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось принять приглашение.' : error.message }, { status });
  }
}

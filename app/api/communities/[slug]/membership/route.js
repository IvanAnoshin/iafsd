import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { getCommunityForUser, joinOrRequestCommunity, leaveCommunity } from '@/lib/communities';
import { enforceRateLimit } from '@/lib/anti-abuse';

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

    const membershipLimit = await enforceRateLimit({ request, policy: 'community_join', actorUserId: session.user.id });
    if (membershipLimit) return membershipLimit;

    const { slug } = await params;
    const payload = await request.json().catch(() => ({}));
    const action = String(payload?.action || 'join').toLowerCase();

    let result;
    if (action === 'leave') result = await leaveCommunity(slug, session.user.id);
    else result = await joinOrRequestCommunity(slug, session.user.id, payload || {});

    const community = await getCommunityForUser(slug, session.user.id);

    await writeAuditLog({
      request,
      session,
      action: `community.membership.${action}`,
      entityType: 'community',
      entityId: community?.id ? String(community.id) : String(slug),
      metadata: { result: result.status },
    }).catch(() => null);

    return NextResponse.json({ status: result.status, community }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/membership failed', error);
    await writeAuditLog({ request, session, action: 'community.membership', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось изменить участие в сообществе.' : error.message }, { status });
  }
}

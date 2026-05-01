import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { communitySerializers, createCommunityInvite, listCommunityInvites } from '@/lib/communities';
import { enforceRateLimit } from '@/lib/anti-abuse';

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const { slug } = await params;
    const invites = await listCommunityInvites(slug, session.user.id);
    return NextResponse.json({ invites: invites.map(communitySerializers.serializeInvite) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/invites list failed', error);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось загрузить приглашения.' : error.message }, { status });
  }
}

export async function POST(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const inviteLimit = await enforceRateLimit({ request, policy: 'community_invite_create', actorUserId: session.user.id });
    if (inviteLimit) return inviteLimit;

    const { slug } = await params;
    const payload = await request.json().catch(() => ({}));
    const invite = await createCommunityInvite(slug, session.user.id, payload || {});

    await writeAuditLog({
      request,
      session,
      action: 'community.invite.create',
      entityType: 'community_invite',
      entityId: invite.id,
      metadata: { slug, usage_limit: invite.usageLimit },
    }).catch(() => null);

    return NextResponse.json({ invite: communitySerializers.serializeInvite(invite) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/invite create failed', error);
    await writeAuditLog({ request, session, action: 'community.invite.create', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось создать приглашение.' : error.message }, { status });
  }
}

import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createCommunityForUser, listCommunitiesForUser, serializeCommunity } from '@/lib/communities';
import { enforceRateLimit } from '@/lib/anti-abuse';

function buildCommunitiesFallbackPayload() {
  return { communities: [], degraded: true };
}

export async function GET(request) {
  let session = null;

  try {
    session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || 24;
    const scope = searchParams.get('scope') || 'discover';
    const query = searchParams.get('q') || searchParams.get('query') || '';
    const communities = await listCommunitiesForUser(session.user.id, { query, scope, limit });

    return NextResponse.json({ communities }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.warn('communities/list fallback enabled', error?.message || error);
    if (!session?.user) {
      return NextResponse.json({ error: 'Не удалось загрузить список сообществ.' }, { status: 500 });
    }

    return NextResponse.json(buildCommunitiesFallbackPayload(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export async function POST(request) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const createLimit = await enforceRateLimit({ request, policy: 'community_create', actorUserId: session.user.id });
    if (createLimit) return createLimit;

    const payload = await request.json().catch(() => null);
    const community = await createCommunityForUser(payload || {}, session.user.id);

    await writeAuditLog({
      request,
      session,
      action: 'community.create',
      entityType: 'community',
      entityId: String(community.id),
      metadata: { slug: community.slug, visibility: community.visibility },
    }).catch(() => null);

    return NextResponse.json({ community: serializeCommunity(community, new Map(), { membership: { role: 'owner' } }) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/create failed', error);
    await writeAuditLog({ request, session, action: 'community.create', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось создать сообщество.' : error.message }, { status });
  }
}

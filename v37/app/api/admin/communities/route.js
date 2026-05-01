import { NextResponse } from 'next/server';
import { requireAdminSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createCommunity, listAdminCommunities, serializeCommunity } from '@/lib/communities';

export async function GET(request) {
  let session = null;
  try {
    session = await requireAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';
    const limit = searchParams.get('limit') || 40;
    const communities = await listAdminCommunities({ status, limit });

    await writeAuditLog({
      request,
      session,
      action: 'admin.communities.list',
      metadata: { status, limit: Number(limit) || 40, count: communities.length },
    });

    return NextResponse.json({ communities }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('admin/communities list failed', error);
    await writeAuditLog({ request, session, action: 'admin.communities.list', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось загрузить список сообществ.' }, { status: 500 });
  }
}

export async function POST(request) {
  let session = null;
  try {
    session = await requireAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });
    }

    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const payload = await request.json().catch(() => null);
    const community = await createCommunity(payload || {});

    await writeAuditLog({
      request,
      session,
      action: 'admin.communities.create',
      entityType: 'community',
      entityId: String(community.id),
      metadata: { slug: community.slug, name: community.name, visibility: community.visibility, is_official: community.isOfficial },
    });

    return NextResponse.json({ community: serializeCommunity(community) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('admin/communities create failed', error);
    await writeAuditLog({ request, session, action: 'admin.communities.create', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: error?.status === 400 ? error.message : 'Не удалось создать сообщество.' }, { status: error?.status === 400 ? 400 : 500 });
  }
}

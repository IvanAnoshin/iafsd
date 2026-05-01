import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { getCommunityForUser, serializeCommunity, updateCommunitySettings } from '@/lib/communities';

function buildCommunityDetailFallbackPayload() {
  return { community: null, degraded: true };
}

export async function GET(request, { params }) {
  let session = null;

  try {
    session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }
    await touchSession(session.id);
    const { slug } = await params;
    const community = await getCommunityForUser(slug, session.user.id);
    if (!community) {
      return NextResponse.json({ error: 'Сообщество не найдено или скрыто.' }, { status: 404 });
    }
    return NextResponse.json({ community }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.warn('communities/detail fallback enabled', error?.message || error);
    if (!session?.user) {
      return NextResponse.json({ error: 'Не удалось загрузить сообщество.' }, { status: 500 });
    }

    return NextResponse.json(buildCommunityDetailFallbackPayload(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export async function PATCH(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const { slug } = await params;
    const payload = await request.json().catch(() => ({}));
    const updated = await updateCommunitySettings(slug, session.user.id, payload || {});
    const community = serializeCommunity(updated, new Map(), { membership: { role: updated.members?.find((item) => item.userId === session.user.id)?.role || 'admin', status: 'active' } });

    await writeAuditLog({
      request,
      session,
      action: 'community.settings.update',
      entityType: 'community',
      entityId: String(updated.id),
      metadata: { slug: updated.slug },
    }).catch(() => null);

    return NextResponse.json({ message: 'Настройки сообщества сохранены.', community }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/update failed', error);
    await writeAuditLog({ request, session, action: 'community.settings.update', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось сохранить настройки сообщества.' : error.message }, { status });
  }
}

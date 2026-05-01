import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { communitySerializers, moderateCommunityMember, removeCommunityMember, updateCommunityMemberRole } from '@/lib/communities';

export async function PATCH(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const { slug, memberId } = await params;
    const payload = await request.json().catch(() => ({}));
    const moderationAction = String(payload?.action || '').trim().toLowerCase();
    const member = moderationAction
      ? await moderateCommunityMember(slug, memberId, session.user.id, moderationAction, payload || {})
      : await updateCommunityMemberRole(slug, memberId, session.user.id, payload?.role);

    await writeAuditLog({
      request,
      session,
      action: moderationAction ? 'community.member.moderate' : 'community.member.role.update',
      entityType: 'community_member',
      entityId: String(member.id),
      metadata: { slug, role: member.role, moderation_action: moderationAction || null },
    }).catch(() => null);

    return NextResponse.json({ member: communitySerializers.serializeMember(member) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/member role failed', error);
    await writeAuditLog({ request, session, action: 'community.member.role.update', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось изменить участника.' : error.message }, { status });
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

    const { slug, memberId } = await params;
    const result = await removeCommunityMember(slug, memberId, session.user.id);

    await writeAuditLog({
      request,
      session,
      action: 'community.member.remove',
      entityType: 'community_member',
      entityId: String(memberId),
      metadata: { slug, target_user_id: result.member?.userId },
    }).catch(() => null);

    return NextResponse.json({ message: 'Участник удалён из сообщества.', removed_member_id: Number(memberId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/member remove failed', error);
    await writeAuditLog({ request, session, action: 'community.member.remove', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось удалить участника.' : error.message }, { status });
  }
}

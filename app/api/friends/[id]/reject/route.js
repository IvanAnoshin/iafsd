import { NextResponse } from 'next/server';
import { getCurrentSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { rejectFriendRequest } from '@/lib/social';

export async function DELETE(request, { params }) {
  const targetUserId = Number((await params).id);
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    const { message } = await rejectFriendRequest(session.user.id, targetUserId);
    await writeAuditLog({ request, session, action: 'social.friend_request.reject', entityType: 'user', entityId: targetUserId, metadata: { targetUserId } });
    return NextResponse.json({ message, target_user_id: targetUserId });
  } catch (error) {
    await writeAuditLog({ request, action: 'social.friend_request.reject', entityType: 'user', entityId: targetUserId, status: 'error', metadata: { targetUserId, error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось отклонить заявку.' }, { status: error?.status || 500 });
  }
}

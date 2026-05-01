import { NextResponse } from 'next/server';
import { getCurrentSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { acceptFriendRequest } from '@/lib/social';

export async function POST(request, { params }) {
  const targetUserId = Number((await params).id);
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    const result = await acceptFriendRequest(session.user.id, targetUserId);
    if (result.accepted) {
      await createNotification({
        userId: targetUserId,
        actorUserId: session.user.id,
        type: 'friend_request_accepted',
        title: 'Заявка в друзья принята',
        body: `${session.user.firstName} ${session.user.lastName}`.trim() + ' принял(а) вашу заявку в друзья.',
        targetLabel: 'Теперь вы в друзьях.',
        entityType: 'user',
        entityId: session.user.id,
        payload: { profileId: session.user.id },
      });
    }
    await writeAuditLog({ request, session, action: 'social.friend_request.accept', entityType: 'user', entityId: targetUserId, metadata: { targetUserId, accepted: result.accepted || false } });
    return NextResponse.json({ message: result.message, target_user_id: targetUserId, accepted: result.accepted || false });
  } catch (error) {
    await writeAuditLog({ request, action: 'social.friend_request.accept', entityType: 'user', entityId: targetUserId, status: 'error', metadata: { targetUserId, error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось принять заявку.' }, { status: error?.status || 500 });
  }
}

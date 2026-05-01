import { NextResponse } from 'next/server';
import { getCurrentSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { sendFriendRequest, cancelFriendRequest } from '@/lib/social';

export async function POST(request, { params }) {
  const targetUserId = Number((await params).id);
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    const result = await sendFriendRequest(session.user.id, targetUserId);
    if (result.created) {
      await createNotification({
        userId: targetUserId,
        actorUserId: session.user.id,
        type: 'friend_request',
        title: 'Новая заявка в друзья',
        body: `${session.user.firstName} ${session.user.lastName}`.trim() + ' отправил(а) вам заявку в друзья.',
        targetLabel: 'Откройте профиль, чтобы ответить на заявку.',
        entityType: 'user',
        entityId: session.user.id,
        payload: { profileId: session.user.id },
      });
    } else if (result.autoAccepted) {
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
    await writeAuditLog({ request, session, action: 'social.friend_request.send', entityType: 'user', entityId: targetUserId, metadata: { targetUserId, created: result.created || false, autoAccepted: result.autoAccepted || false } });
    return NextResponse.json({ message: result.message, target_user_id: targetUserId, created: result.created || false, auto_accepted: result.autoAccepted || false });
  } catch (error) {
    await writeAuditLog({ request, action: 'social.friend_request.send', entityType: 'user', entityId: targetUserId, status: 'error', metadata: { targetUserId, error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось отправить заявку.' }, { status: error?.status || 500 });
  }
}

export async function DELETE(request, { params }) {
  const targetUserId = Number((await params).id);
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    const result = await cancelFriendRequest(session.user.id, targetUserId);
    await writeAuditLog({ request, session, action: 'social.friend_request.cancel', entityType: 'user', entityId: targetUserId, metadata: { targetUserId } });
    return NextResponse.json({ message: result.message, target_user_id: targetUserId });
  } catch (error) {
    await writeAuditLog({ request, action: 'social.friend_request.cancel', entityType: 'user', entityId: targetUserId, status: 'error', metadata: { targetUserId, error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось отменить заявку.' }, { status: error?.status || 500 });
  }
}

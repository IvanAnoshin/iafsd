import { NextResponse } from 'next/server';
import { getCurrentSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { followUser, unfollowUser } from '@/lib/social';

export async function POST(request, { params }) {
  const targetUserId = Number((await params).id);
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    const result = await followUser(session.user.id, targetUserId);
    if (result.created) {
      await createNotification({
        userId: targetUserId,
        actorUserId: session.user.id,
        type: 'follow',
        title: 'Новый подписчик',
        body: `${session.user.firstName} ${session.user.lastName}`.trim() + ' подписался(ась) на вас.',
        targetLabel: 'Посмотреть профиль подписчика.',
        entityType: 'user',
        entityId: session.user.id,
        payload: { profileId: session.user.id },
      });
    }
    await writeAuditLog({ request, session, action: 'social.follow', entityType: 'user', entityId: targetUserId, metadata: { targetUserId, created: result.created || false } });
    return NextResponse.json({ message: result.message, target_user_id: targetUserId, created: result.created || false });
  } catch (error) {
    await writeAuditLog({ request, action: 'social.follow', entityType: 'user', entityId: targetUserId, status: 'error', metadata: { targetUserId, error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось оформить подписку.' }, { status: error?.status || 500 });
  }
}

export async function DELETE(request, { params }) {
  const targetUserId = Number((await params).id);
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    const result = await unfollowUser(session.user.id, targetUserId);
    await writeAuditLog({ request, session, action: 'social.unfollow', entityType: 'user', entityId: targetUserId, metadata: { targetUserId, removed: result.removed || false } });
    return NextResponse.json({ message: result.message, target_user_id: targetUserId, removed: result.removed || false });
  } catch (error) {
    await writeAuditLog({ request, action: 'social.unfollow', entityType: 'user', entityId: targetUserId, status: 'error', metadata: { targetUserId, error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось отменить подписку.' }, { status: error?.status || 500 });
  }
}

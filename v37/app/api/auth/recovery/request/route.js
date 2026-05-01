import { NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/audit';
import { createRecoverySession, findRecoveryUser, getAvailableRecoveryMethods } from '@/lib/recovery';

export async function POST(request) {
  try {
    const body = await request.json();
    const { firstName, lastName, key, user } = await findRecoveryUser(body.first_name, body.last_name);

    if (!firstName || !lastName) {
      await writeAuditLog({ request, action: 'auth.recovery.request', status: 'failed', metadata: { reason: 'missing_name' } });
      return NextResponse.json({ error: 'Введите имя и фамилию.' }, { status: 400 });
    }

    if (!user) {
      await writeAuditLog({ request, action: 'auth.recovery.request', status: 'failed', metadata: { reason: 'user_not_found', normalizedKey: key } });
      return NextResponse.json({ error: 'Пользователь не найден.' }, { status: 404 });
    }

    const recovery = await createRecoverySession(user, {
      source: 'manual_request',
      firstName,
      lastName,
    });

    await writeAuditLog({
      request,
      actorUserId: user.id,
      action: 'auth.recovery.request',
      entityType: 'recovery_session',
      entityId: recovery.id,
      metadata: { methods: getAvailableRecoveryMethods(user).map((item) => item.key) },
    });

    return NextResponse.json({
      message: 'Сессия восстановления создана.',
      recovery_id: recovery.id,
      status: recovery.status,
      expires_at: recovery.expiresAt,
      methods: getAvailableRecoveryMethods(user),
    });
  } catch (error) {
    console.error('auth/recovery/request failed', error);
    await writeAuditLog({ request, action: 'auth.recovery.request', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось начать восстановление.' }, { status: 500 });
  }
}

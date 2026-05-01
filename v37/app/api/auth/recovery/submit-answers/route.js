import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { cleanupExpiredRecoverySessionById, getAvailableRecoveryMethods, verifyRecoveryMethod } from '@/lib/recovery';

export async function POST(request) {
  try {
    const body = await request.json();
    const recoveryId = String(body.recovery_id || '').trim();
    const method = String(body.method || '').trim();

    if (!recoveryId || !method) {
      await writeAuditLog({ request, action: 'auth.recovery.submit_answers', status: 'failed', metadata: { reason: 'missing_fields' } });
      return NextResponse.json({ error: 'Не указан recovery_id или способ проверки.' }, { status: 400 });
    }

    const recovery = await cleanupExpiredRecoverySessionById(recoveryId);
    if (!recovery) {
      await writeAuditLog({ request, action: 'auth.recovery.submit_answers', status: 'failed', metadata: { reason: 'recovery_not_found', recoveryId } });
      return NextResponse.json({ error: 'Сессия восстановления не найдена.' }, { status: 404 });
    }

    if (recovery.status === 'completed') {
      return NextResponse.json({ error: 'Восстановление уже завершено.' }, { status: 409 });
    }

    if (recovery.status === 'expired' || recovery.expiresAt.getTime() <= Date.now()) {
      await prisma.recoverySession.update({ where: { id: recovery.id }, data: { status: 'expired' } }).catch(() => {});
      await writeAuditLog({ request, actorUserId: recovery.userId, action: 'auth.recovery.submit_answers', status: 'failed', entityType: 'recovery_session', entityId: recovery.id, metadata: { reason: 'expired' } });
      return NextResponse.json({ error: 'Сессия восстановления истекла. Начни заново.' }, { status: 410 });
    }

    const verification = await verifyRecoveryMethod(recovery.user, method, body);
    if (!verification.ok) {
      await writeAuditLog({ request, actorUserId: recovery.userId, action: 'auth.recovery.submit_answers', status: 'failed', entityType: 'recovery_session', entityId: recovery.id, metadata: { reason: verification.reason, method } });
      return NextResponse.json({ error: 'Проверка не пройдена.' }, { status: 401 });
    }

    const nextMetadata = {
      ...(recovery.metadata && typeof recovery.metadata === 'object' ? recovery.metadata : {}),
      verified_method: method,
    };
    if (method === 'backup_code' && Number.isInteger(verification.matchedIndex)) {
      nextMetadata.matched_backup_code_index = verification.matchedIndex;
    }

    const updated = await prisma.recoverySession.update({
      where: { id: recovery.id },
      data: {
        status: 'verified',
        verificationMethod: method,
        verifiedAt: new Date(),
        metadata: nextMetadata,
      },
      include: { user: true },
    });

    await writeAuditLog({ request, actorUserId: updated.userId, action: 'auth.recovery.submit_answers', entityType: 'recovery_session', entityId: updated.id, metadata: { method } });

    return NextResponse.json({
      message: 'Проверка пройдена.',
      recovery_id: updated.id,
      status: updated.status,
      verified: true,
      verification_method: updated.verificationMethod,
      can_complete: true,
      methods: getAvailableRecoveryMethods(updated.user),
    });
  } catch (error) {
    console.error('auth/recovery/submit-answers failed', error);
    await writeAuditLog({ request, action: 'auth.recovery.submit_answers', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось проверить данные для восстановления.' }, { status: 500 });
  }
}

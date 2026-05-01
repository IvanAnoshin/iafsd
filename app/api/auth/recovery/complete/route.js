import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { applySessionCookie, createSessionForUser, ensureCsrfCookie } from '@/lib/auth';
import { cleanupExpiredRecoverySessionById, validateNewPassword, verifyRecoveryCompletionToken } from '@/lib/recovery';
import { enforceRateLimit, getClientIp } from '@/lib/anti-abuse';

export async function POST(request) {
  try {
    const body = await request.json();
    const recoveryId = String(body.recovery_id || '').trim();
    const completionToken = String(body.completion_token || '').trim();
    const newPassword = String(body.new_password || '');
    const confirmPassword = String(body.confirm_password || '');

    const recoveryLimit = await enforceRateLimit({
      request,
      policy: 'auth_recovery_complete',
      subject: `recovery-complete:${getClientIp(request)}:${recoveryId || 'missing'}`,
    });
    if (recoveryLimit) return recoveryLimit;

    if (!recoveryId) {
      await writeAuditLog({ request, action: 'auth.recovery.complete', status: 'failed', metadata: { reason: 'missing_recovery_id' } });
      return NextResponse.json({ error: 'Не указан recovery_id.' }, { status: 400 });
    }

    const passwordError = validateNewPassword(newPassword, confirmPassword);
    if (passwordError) {
      await writeAuditLog({ request, action: 'auth.recovery.complete', status: 'failed', metadata: { reason: 'invalid_password_payload' } });
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const recovery = await cleanupExpiredRecoverySessionById(recoveryId);
    if (!recovery) {
      await writeAuditLog({ request, action: 'auth.recovery.complete', status: 'failed', metadata: { reason: 'recovery_not_found', recoveryId } });
      return NextResponse.json({ error: 'Сессия восстановления не найдена.' }, { status: 404 });
    }

    if (recovery.status !== 'verified' || !recovery.verifiedAt) {
      await writeAuditLog({ request, actorUserId: recovery.userId, action: 'auth.recovery.complete', status: 'failed', entityType: 'recovery_session', entityId: recovery.id, metadata: { reason: 'not_verified' } });
      return NextResponse.json({ error: 'Сначала подтверди восстановление.' }, { status: 409 });
    }

    if (recovery.expiresAt.getTime() <= Date.now()) {
      await prisma.recoverySession.update({ where: { id: recovery.id }, data: { status: 'expired' } }).catch(() => {});
      await writeAuditLog({ request, actorUserId: recovery.userId, action: 'auth.recovery.complete', status: 'failed', entityType: 'recovery_session', entityId: recovery.id, metadata: { reason: 'expired' } });
      return NextResponse.json({ error: 'Сессия восстановления истекла. Начни заново.' }, { status: 410 });
    }

    if (!verifyRecoveryCompletionToken(recovery, completionToken)) {
      await writeAuditLog({ request, actorUserId: recovery.userId, action: 'auth.recovery.complete', status: 'failed', entityType: 'recovery_session', entityId: recovery.id, metadata: { reason: 'bad_completion_token' } });
      return NextResponse.json({ error: 'Recovery-подтверждение устарело. Пройди проверку ещё раз.', code: 'BAD_RECOVERY_COMPLETION_TOKEN' }, { status: 401 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const metadata = recovery.metadata && typeof recovery.metadata === 'object' ? recovery.metadata : {};
    const matchedIndex = Number.isInteger(metadata.matched_backup_code_index) ? metadata.matched_backup_code_index : null;

    const user = await prisma.$transaction(async (tx) => {
      const currentUser = await tx.user.findUnique({ where: { id: recovery.userId } });
      if (!currentUser) {
        throw new Error('RECOVERY_USER_NOT_FOUND');
      }

      let nextBackupHashes = currentUser.backupCodeHashes;
      if (recovery.verificationMethod === 'backup_code' && matchedIndex != null && Array.isArray(currentUser.backupCodeHashes)) {
        nextBackupHashes = currentUser.backupCodeHashes.filter((_, index) => index !== matchedIndex);
      }

      const updatedUser = await tx.user.update({
        where: { id: currentUser.id },
        data: {
          passwordHash,
          backupCodeHashes: nextBackupHashes,
        },
      });

      await tx.session.deleteMany({ where: { userId: currentUser.id } });
      await tx.recoverySession.update({
        where: { id: recovery.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          metadata: {
            ...metadata,
            password_reset: true,
            completion_token_hash: null,
          },
        },
      });

      return updatedUser;
    });

    const { plainToken, session } = await createSessionForUser(user.id, request);
    const response = NextResponse.json({
      message: 'Пароль обновлён. Доступ восстановлен.',
      user: {
        id: user.id,
        first_name: user.firstName,
        last_name: user.lastName,
        created_at: user.createdAt,
      },
    });
    applySessionCookie(response, plainToken, session.expiresAt);
    ensureCsrfCookie(response, request);

    await writeAuditLog({ request, actorUserId: user.id, session, action: 'auth.recovery.complete', entityType: 'recovery_session', entityId: recovery.id, metadata: { verificationMethod: recovery.verificationMethod } });

    return response;
  } catch (error) {
    console.error('auth/recovery/complete failed', error);
    await writeAuditLog({ request, action: 'auth.recovery.complete', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось завершить восстановление.' }, { status: 500 });
  }
}

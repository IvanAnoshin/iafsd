import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { getRecoveryPrompt, listRecoveryReadiness } from '@/lib/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildSecurityStatusFallback(user) {
  const backupCodesRemaining = Array.isArray(user?.backupCodeHashes) ? user.backupCodeHashes.length : 0;
  const hasSecretAnswer = Boolean(user?.secretAnswerHash);
  return {
    question_prompt: getRecoveryPrompt(),
    has_secret_answer: hasSecretAnswer,
    backup_codes_remaining: backupCodesRemaining,
    has_recovery_phrase: Boolean(user?.recoveryPhraseHash),
    trusted_recovery_devices: 0,
    passkeys_count: 0,
    security_configured: false,
    needs_secret_answer: !hasSecretAnswer,
    needs_backup_codes: backupCodesRemaining === 0,
    needs_recovery_phrase: !user?.recoveryPhraseHash,
    needs_passkey: true,
    degraded: true,
  };
}

export async function GET() {
  let session = null;

  try {
    session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    await touchSession(session.id);

    const backupCodeHashes = Array.isArray(session.user.backupCodeHashes) ? session.user.backupCodeHashes : [];
    const hasSecretAnswer = Boolean(session.user.secretAnswerHash);
    const backupCodesRemaining = backupCodeHashes.length;
    const readiness = await listRecoveryReadiness(session.user);

    return NextResponse.json({
      status: {
        question_prompt: getRecoveryPrompt(),
        has_secret_answer: hasSecretAnswer,
        backup_codes_remaining: backupCodesRemaining,
        has_recovery_phrase: readiness.has_recovery_phrase,
        trusted_recovery_devices: readiness.trusted_recovery_devices,
        passkeys_count: readiness.passkeys_count,
        security_configured: hasSecretAnswer && backupCodesRemaining > 0 && readiness.has_recovery_phrase && readiness.passkeys_count > 0,
        needs_secret_answer: !hasSecretAnswer,
        needs_backup_codes: backupCodesRemaining === 0,
        needs_recovery_phrase: !readiness.has_recovery_phrase,
        needs_passkey: readiness.passkeys_count === 0,
      },
    });
  } catch (error) {
    console.warn('auth/security/status fallback enabled', error?.message || error);
    if (!session?.user) {
      return NextResponse.json({ error: 'Не удалось получить статус защиты аккаунта.' }, { status: 500 });
    }
    return NextResponse.json({ status: buildSecurityStatusFallback(session.user) }, { headers: { 'Cache-Control': 'no-store' } });
  }
}

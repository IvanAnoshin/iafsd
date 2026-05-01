import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { getRecoveryPrompt } from '@/lib/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    await touchSession(session.id);

    const backupCodeHashes = Array.isArray(session.user.backupCodeHashes) ? session.user.backupCodeHashes : [];
    const hasSecretAnswer = Boolean(session.user.secretAnswerHash);
    const backupCodesRemaining = backupCodeHashes.length;

    return NextResponse.json({
      status: {
        question_prompt: getRecoveryPrompt(),
        has_secret_answer: hasSecretAnswer,
        backup_codes_remaining: backupCodesRemaining,
        security_configured: hasSecretAnswer && backupCodesRemaining > 0,
        needs_secret_answer: !hasSecretAnswer,
        needs_backup_codes: backupCodesRemaining === 0,
      },
    });
  } catch (error) {
    console.error('auth/security/status failed', error);
    return NextResponse.json({ error: 'Не удалось получить статус защиты аккаунта.' }, { status: 500 });
  }
}

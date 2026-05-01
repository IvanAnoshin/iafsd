import { NextResponse } from 'next/server';
import { cleanupExpiredRecoverySessionById, getAvailableRecoveryMethods } from '@/lib/recovery';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const recoveryId = String(searchParams.get('recovery_id') || '').trim();
    if (!recoveryId) {
      return NextResponse.json({ error: 'Не указан recovery_id.' }, { status: 400 });
    }

    const recovery = await cleanupExpiredRecoverySessionById(recoveryId);
    if (!recovery) {
      return NextResponse.json({ error: 'Сессия восстановления не найдена.' }, { status: 404 });
    }

    return NextResponse.json({
      recovery_id: recovery.id,
      status: recovery.status,
      verified: Boolean(recovery.verifiedAt),
      verification_method: recovery.verificationMethod,
      expires_at: recovery.expiresAt,
      completed_at: recovery.completedAt,
      methods: getAvailableRecoveryMethods(recovery.user),
      can_complete: recovery.status === 'verified' && recovery.expiresAt.getTime() > Date.now(),
    });
  } catch (error) {
    console.error('auth/recovery/status failed', error);
    return NextResponse.json({ error: 'Не удалось получить статус восстановления.' }, { status: 500 });
  }
}

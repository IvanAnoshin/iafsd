import { NextResponse } from 'next/server';
import { cleanupExpiredRecoverySessionById, getAvailableRecoveryMethods, getRecoveryPrompt } from '@/lib/recovery';

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
      prompt: getRecoveryPrompt(),
      methods: getAvailableRecoveryMethods(recovery.user),
    });
  } catch (error) {
    console.error('auth/recovery/questions failed', error);
    return NextResponse.json({ error: 'Не удалось получить способы восстановления.' }, { status: 500 });
  }
}

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

    return NextResponse.json({
      prompt: getRecoveryPrompt(),
      has_secret_answer: Boolean(session.user.secretAnswerHash),
    });
  } catch (error) {
    console.error('auth/security/question failed', error);
    return NextResponse.json({ error: 'Не удалось получить секретный вопрос.' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) {
      await writeAuditLog({ request, action: 'auth.security.verify_answer', status: 'failed', metadata: { reason: 'missing_session' } });
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    await touchSession(session.id);

    const secretAnswer = String((await request.json())?.secret_answer || '').trim();
    if (!secretAnswer) {
      await writeAuditLog({ request, session, action: 'auth.security.verify_answer', status: 'failed', metadata: { reason: 'missing_secret_answer' } });
      return NextResponse.json({ error: 'Введите секретный ответ.' }, { status: 400 });
    }

    if (!session.user.secretAnswerHash) {
      await writeAuditLog({ request, session, action: 'auth.security.verify_answer', status: 'failed', metadata: { reason: 'secret_not_configured' } });
      return NextResponse.json({ error: 'Секретный ответ ещё не настроен.' }, { status: 409 });
    }

    const verified = await bcrypt.compare(secretAnswer, session.user.secretAnswerHash);
    if (!verified) {
      await writeAuditLog({ request, session, action: 'auth.security.verify_answer', status: 'failed', metadata: { reason: 'invalid_secret_answer' } });
      return NextResponse.json({ error: 'Секретный ответ не подошёл.', verified: false }, { status: 401 });
    }

    await writeAuditLog({ request, session, action: 'auth.security.verify_answer', entityType: 'user', entityId: session.user.id });
    return NextResponse.json({ message: 'Секретный ответ подтверждён.', verified: true });
  } catch (error) {
    console.error('auth/security/verify-answer failed', error);
    await writeAuditLog({ request, action: 'auth.security.verify_answer', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось проверить секретный ответ.' }, { status: 500 });
  }
}

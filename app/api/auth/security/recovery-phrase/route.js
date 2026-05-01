import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { generateRecoveryPhrase, hashRecoveryPhrase } from '@/lib/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  let auditSession = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    auditSession = session;
    if (!session) {
      await writeAuditLog({ request, action: 'auth.security.recovery_phrase', status: 'failed', metadata: { reason: 'missing_session' } });
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    await touchSession(session.id);
    const body = await request.json();
    const password = String(body.password || '').trim();
    if (!password) {
      await writeAuditLog({ request, session, action: 'auth.security.recovery_phrase', status: 'failed', metadata: { reason: 'missing_password' } });
      return NextResponse.json({ error: 'Введите пароль.' }, { status: 400 });
    }

    const passwordOk = await bcrypt.compare(password, session.user.passwordHash);
    if (!passwordOk) {
      await writeAuditLog({ request, session, action: 'auth.security.recovery_phrase', status: 'failed', metadata: { reason: 'bad_password' } });
      return NextResponse.json({ error: 'Неверный пароль.' }, { status: 401 });
    }

    const phrase = generateRecoveryPhrase(8);
    const recoveryPhraseHash = await hashRecoveryPhrase(phrase);

    await prisma.user.update({
      where: { id: session.userId },
      data: { recoveryPhraseHash },
    });

    await writeAuditLog({
      request,
      session,
      action: 'auth.security.recovery_phrase',
      entityType: 'user',
      entityId: session.userId,
      metadata: { regenerated: Boolean(session.user.recoveryPhraseHash), wordCount: phrase.split(' ').length },
    });

    return NextResponse.json({
      message: 'Recovery-фраза создана. Сохраните её сейчас: позже она не будет показана снова.',
      recovery_phrase: phrase,
    });
  } catch (error) {
    console.error('auth/security/recovery-phrase failed', error);
    await writeAuditLog({ request, session: auditSession, action: 'auth.security.recovery_phrase', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось создать recovery-фразу.' }, { status: 500 });
  }
}

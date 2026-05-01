import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { generateBackupCodes } from '@/lib/dfsn';
import { getRecoveryPrompt } from '@/lib/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) {
      await writeAuditLog({ request, action: 'auth.security.setup', status: 'failed', metadata: { reason: 'missing_session' } });
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    await touchSession(session.id);

    const body = await request.json();
    const password = String(body.password || '').trim();
    const secretAnswer = String(body.secret_answer || '').trim();
    const forceRegenerateCodes = Boolean(body.regenerate_codes);

    if (!password || !secretAnswer) {
      await writeAuditLog({ request, session, action: 'auth.security.setup', status: 'failed', metadata: { reason: 'missing_fields' } });
      return NextResponse.json({ error: 'Введите пароль и секретный ответ.' }, { status: 400 });
    }

    if (secretAnswer.length < 3) {
      await writeAuditLog({ request, session, action: 'auth.security.setup', status: 'failed', metadata: { reason: 'secret_too_short' } });
      return NextResponse.json({ error: 'Секретный ответ слишком короткий.' }, { status: 400 });
    }

    const passwordOk = await bcrypt.compare(password, session.user.passwordHash);
    if (!passwordOk) {
      await writeAuditLog({ request, session, action: 'auth.security.setup', status: 'failed', metadata: { reason: 'bad_password' } });
      return NextResponse.json({ error: 'Неверный пароль.' }, { status: 401 });
    }

    const secretAnswerHash = await bcrypt.hash(secretAnswer, 10);
    let backup_codes = [];
    let backupCodeHashes = Array.isArray(session.user.backupCodeHashes) ? session.user.backupCodeHashes : [];
    const shouldGenerateCodes = forceRegenerateCodes || backupCodeHashes.length === 0;

    if (shouldGenerateCodes) {
      backup_codes = generateBackupCodes(10);
      backupCodeHashes = await Promise.all(backup_codes.map((code) => bcrypt.hash(code, 10)));
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        secretAnswerHash,
        backupCodeHashes,
      },
    });

    await writeAuditLog({
      request,
      session,
      action: 'auth.security.setup',
      entityType: 'user',
      entityId: session.user.id,
      metadata: {
        regeneratedCodes: shouldGenerateCodes,
        codesCount: backupCodeHashes.length,
      },
    });

    return NextResponse.json({
      message: shouldGenerateCodes ? 'Защита аккаунта настроена, новые резервные коды сгенерированы.' : 'Защита аккаунта настроена.',
      question_prompt: getRecoveryPrompt(),
      backup_codes,
      status: {
        has_secret_answer: true,
        backup_codes_remaining: backupCodeHashes.length,
        security_configured: backupCodeHashes.length > 0,
      },
    });
  } catch (error) {
    console.error('auth/security/setup failed', error);
    await writeAuditLog({ request, action: 'auth.security.setup', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось настроить защиту аккаунта.' }, { status: 500 });
  }
}

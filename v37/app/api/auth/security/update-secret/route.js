import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { getCurrentSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    const session = await getCurrentSession();
    if (!session) {
      await writeAuditLog({ request, action: 'auth.security.update_secret', status: 'failed', metadata: { reason: 'missing_session' } });
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    const body = await request.json();
    const password = String(body.password || '').trim();
    const secretAnswer = String(body.secret_answer || '').trim();

    if (!password || !secretAnswer) {
      await writeAuditLog({ request, session, action: 'auth.security.update_secret', status: 'failed', metadata: { reason: 'missing_fields' } });
      return NextResponse.json({ error: 'Введите пароль и новый секретный ответ.' }, { status: 400 });
    }

    if (secretAnswer.length < 3) {
      await writeAuditLog({ request, session, action: 'auth.security.update_secret', status: 'failed', metadata: { reason: 'secret_too_short' } });
      return NextResponse.json({ error: 'Секретный ответ слишком короткий.' }, { status: 400 });
    }

    const passwordOk = await bcrypt.compare(password, session.user.passwordHash);
    if (!passwordOk) {
      await writeAuditLog({ request, session, action: 'auth.security.update_secret', status: 'failed', metadata: { reason: 'bad_password' } });
      return NextResponse.json({ error: 'Неверный пароль.' }, { status: 401 });
    }

    const secretAnswerHash = await bcrypt.hash(secretAnswer, 10);
    await prisma.user.update({
      where: { id: session.user.id },
      data: { secretAnswerHash },
    });

    await writeAuditLog({ request, session, action: 'auth.security.update_secret', entityType: 'user', entityId: session.user.id });

    return NextResponse.json({ message: 'Секретный ответ обновлён.' });
  } catch (error) {
    console.error('security/update-secret failed', error);
    await writeAuditLog({ request, action: 'auth.security.update_secret', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось обновить секретный ответ.' }, { status: 500 });
  }
}

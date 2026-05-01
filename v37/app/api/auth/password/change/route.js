import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { validateNewPassword } from '@/lib/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) {
      await writeAuditLog({ request, action: 'auth.password.change', status: 'failed', metadata: { reason: 'missing_session' } });
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    await touchSession(session.id);

    const body = await request.json();
    const currentPassword = String(body.current_password || '').trim();
    const newPassword = String(body.new_password || '');
    const confirmPassword = String(body.confirm_password || '');
    const logoutOthers = body.logout_other_sessions !== false;

    if (!currentPassword) {
      await writeAuditLog({ request, session, action: 'auth.password.change', status: 'failed', metadata: { reason: 'missing_current_password' } });
      return NextResponse.json({ error: 'Введите текущий пароль.' }, { status: 400 });
    }

    const currentPasswordOk = await bcrypt.compare(currentPassword, session.user.passwordHash);
    if (!currentPasswordOk) {
      await writeAuditLog({ request, session, action: 'auth.password.change', status: 'failed', metadata: { reason: 'bad_current_password' } });
      return NextResponse.json({ error: 'Текущий пароль неверный.' }, { status: 401 });
    }

    const passwordValidation = validateNewPassword(newPassword, confirmPassword);
    if (passwordValidation) {
      await writeAuditLog({ request, session, action: 'auth.password.change', status: 'failed', metadata: { reason: 'invalid_new_password', message: passwordValidation } });
      return NextResponse.json({ error: passwordValidation }, { status: 400 });
    }

    const samePassword = await bcrypt.compare(newPassword, session.user.passwordHash);
    if (samePassword) {
      await writeAuditLog({ request, session, action: 'auth.password.change', status: 'failed', metadata: { reason: 'same_password' } });
      return NextResponse.json({ error: 'Новый пароль должен отличаться от текущего.' }, { status: 400 });
    }

    const nextHash = await bcrypt.hash(newPassword, 10);

    const tx = [
      prisma.user.update({ where: { id: session.user.id }, data: { passwordHash: nextHash } }),
    ];

    if (logoutOthers) {
      tx.push(prisma.session.deleteMany({ where: { userId: session.user.id, NOT: { id: session.id } } }));
    }

    await prisma.$transaction(tx);

    await writeAuditLog({
      request,
      session,
      action: 'auth.password.change',
      entityType: 'user',
      entityId: session.user.id,
      metadata: { logoutOthers },
    });

    return NextResponse.json({
      message: logoutOthers
        ? 'Пароль обновлён. Остальные сессии завершены.'
        : 'Пароль обновлён.',
    });
  } catch (error) {
    console.error('auth/password/change failed', error);
    await writeAuditLog({ request, action: 'auth.password.change', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось обновить пароль.' }, { status: 500 });
  }
}

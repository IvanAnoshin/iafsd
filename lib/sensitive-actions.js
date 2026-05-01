import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/audit';

export function sensitiveJson(data, init = {}) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      'Cache-Control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

export async function requirePasswordConfirmation({ request, session, password, action = 'sensitive.confirm_password' }) {
  const provided = String(password || '').trim();
  if (!session?.user?.passwordHash) {
    await writeAuditLog({ request, session, action, status: 'failed', metadata: { reason: 'missing_session_password_hash' } }).catch(() => null);
    return sensitiveJson({ error: 'Нужно заново войти в аккаунт.', code: 'REAUTH_REQUIRED' }, { status: 401 });
  }

  if (!provided) {
    await writeAuditLog({ request, session, action, status: 'failed', metadata: { reason: 'missing_password_confirmation' } }).catch(() => null);
    return sensitiveJson({ error: 'Подтверди действие текущим паролем.', code: 'PASSWORD_CONFIRMATION_REQUIRED' }, { status: 400 });
  }

  const ok = await bcrypt.compare(provided, session.user.passwordHash);
  if (!ok) {
    await writeAuditLog({ request, session, action, status: 'failed', metadata: { reason: 'bad_password_confirmation' } }).catch(() => null);
    return sensitiveJson({ error: 'Пароль не подошёл.', code: 'BAD_PASSWORD_CONFIRMATION' }, { status: 401 });
  }

  return null;
}

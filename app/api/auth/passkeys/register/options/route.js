import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createPasskeyRegistrationOptions } from '@/lib/passkeys';
import { enforceRateLimit } from '@/lib/anti-abuse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const csrf = verifyCsrf(request);
  if (!csrf.ok) return csrf.response;

  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });

    const passkeyRegisterLimit = await enforceRateLimit({ request, policy: 'auth_passkey_register', actorUserId: session.user.id });
    if (passkeyRegisterLimit) return passkeyRegisterLimit;

    const body = await request.json().catch(() => ({}));
    const password = String(body.password || '').trim();
    const label = String(body.label || '').trim();

    if (!password) return NextResponse.json({ error: 'Введите текущий пароль.' }, { status: 400 });

    const ok = await bcrypt.compare(password, session.user.passwordHash);
    if (!ok) {
      await writeAuditLog({ request, session, action: 'auth.passkey.register.options', status: 'failed', metadata: { reason: 'bad_password' } });
      return NextResponse.json({ error: 'Пароль не подошёл.' }, { status: 401 });
    }

    await touchSession(session.id);
    const options = await createPasskeyRegistrationOptions({ user: session.user, request, label });
    await writeAuditLog({ request, session, action: 'auth.passkey.register.options', entityType: 'user', entityId: String(session.user.id) });
    return NextResponse.json(options, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('passkey register options failed', error);
    return NextResponse.json({ error: 'Не удалось начать регистрацию passkey.' }, { status: error.status || 500 });
  }
}

import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { serializePasskey, verifyPasskeyRegistration } from '@/lib/passkeys';
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
    const passkey = await verifyPasskeyRegistration({
      user: session.user,
      request,
      challengeId: body.challenge_id,
      credential: body.credential,
      label: body.label,
    });

    await touchSession(session.id);
    await writeAuditLog({ request, session, action: 'auth.passkey.register.verify', entityType: 'account_passkey', entityId: passkey.id });
    return NextResponse.json({ message: 'Passkey добавлен.', passkey: serializePasskey(passkey) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('passkey register verify failed', error);
    await writeAuditLog({ request, action: 'auth.passkey.register.verify', status: 'failed', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    return NextResponse.json({ error: error.message || 'Не удалось сохранить passkey.' }, { status: error.status || 500 });
  }
}

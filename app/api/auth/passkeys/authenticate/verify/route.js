import { NextResponse } from 'next/server';
import { createSessionForUser, applySessionCookie, ensureCsrfCookie } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { verifyPasskeyAuthentication } from '@/lib/passkeys';
import { enforceRateLimit, getClientIp } from '@/lib/anti-abuse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const passkeyVerifyLimit = await enforceRateLimit({
      request,
      policy: 'auth_passkey_verify',
      subject: `passkey-verify:${getClientIp(request)}:${String(body.challenge_id || '').slice(0, 80) || 'missing'}`,
    });
    if (passkeyVerifyLimit) return passkeyVerifyLimit;
    const { user, passkey } = await verifyPasskeyAuthentication({
      request,
      challengeId: body.challenge_id,
      credential: body.credential,
    });

    const { plainToken, session } = await createSessionForUser(user.id, request, {
      deviceContext: body.device_context || {},
    });
    const response = NextResponse.json({
      message: 'Вход по passkey выполнен.',
      user: { id: user.id, first_name: user.firstName, last_name: user.lastName, created_at: user.createdAt },
      passkey: { id: passkey.id, label: passkey.label },
    });
    applySessionCookie(response, plainToken, session.expiresAt);
    ensureCsrfCookie(response, request);
    await writeAuditLog({ request, session, action: 'auth.passkey.authenticate.verify', entityType: 'account_passkey', entityId: passkey.id, metadata: { method: 'passkey' } });
    return response;
  } catch (error) {
    console.error('passkey authenticate verify failed', error);
    await writeAuditLog({ request, action: 'auth.passkey.authenticate.verify', status: 'failed', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    return NextResponse.json({ error: error.message || 'Не удалось войти по passkey.' }, { status: error.status || 500 });
  }
}

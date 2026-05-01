import { NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/audit';
import { normalizeName } from '@/lib/dfsn';
import { createPasskeyAuthenticationOptions } from '@/lib/passkeys';
import { enforceRateLimit, getClientIp } from '@/lib/anti-abuse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const firstName = normalizeName(body.first_name);
    const lastName = normalizeName(body.last_name);
    const passkeyLimit = await enforceRateLimit({
      request,
      policy: 'auth_passkey_options',
      subject: `passkey-options:${getClientIp(request)}:${firstName || 'missing'}:${lastName || 'missing'}`,
    });
    if (passkeyLimit) return passkeyLimit;
    if (!firstName || !lastName) return NextResponse.json({ error: 'Введите имя и фамилию.' }, { status: 400 });

    const { user, options } = await createPasskeyAuthenticationOptions({ firstName, lastName, request });
    if (!user || !options) {
      await writeAuditLog({ request, action: 'auth.passkey.authenticate.options', status: 'failed', metadata: { reason: 'no_passkeys', firstName, lastName } });
      return NextResponse.json({ error: 'Для этого аккаунта passkey не найден.' }, { status: 404 });
    }

    await writeAuditLog({ request, actorUserId: user.id, action: 'auth.passkey.authenticate.options', entityType: 'user', entityId: String(user.id) });
    return NextResponse.json(options, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('passkey authenticate options failed', error);
    return NextResponse.json({ error: 'Не удалось начать вход по passkey.' }, { status: error.status || 500 });
  }
}

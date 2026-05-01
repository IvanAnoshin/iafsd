import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/anti-abuse';
import { requirePasswordConfirmation } from '@/lib/sensitive-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request, { params }) {
  const csrf = verifyCsrf(request);
  if (!csrf.ok) return csrf.response;

  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    const sensitiveLimit = await enforceRateLimit({ request, policy: 'device_sensitive', actorUserId: session.user.id, subject: `passkey-disable:${session.user.id}` });
    if (sensitiveLimit) return sensitiveLimit;

    const body = await request.json().catch(() => ({}));
    const passwordGate = await requirePasswordConfirmation({ request, session, password: body.password, action: 'auth.passkey.disable.confirm' });
    if (passwordGate) return passwordGate;

    const { id } = await params;
    const result = await prisma.accountPasskey.updateMany({
      where: { id: String(id || ''), userId: session.user.id, disabledAt: null },
      data: { disabledAt: new Date() },
    });
    if (!result.count) return NextResponse.json({ error: 'Passkey не найден.' }, { status: 404 });
    await touchSession(session.id);
    await writeAuditLog({ request, session, action: 'auth.passkey.disable', entityType: 'account_passkey', entityId: String(id || '') });
    return NextResponse.json({ message: 'Passkey отключён.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('passkey disable failed', error);
    return NextResponse.json({ error: 'Не удалось отключить passkey.' }, { status: 500 });
  }
}

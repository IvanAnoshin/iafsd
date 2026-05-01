import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { normalizeName, normalizedKey } from '@/lib/dfsn';
import { createSessionForUser, applySessionCookie, ensureCsrfCookie } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { revokeUserSessionsForRecovery, verifyRecoveryMethod } from '@/lib/recovery';
import { enforceRateLimit, getClientIp } from '@/lib/anti-abuse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json();
    const firstName = normalizeName(body.first_name);
    const lastName = normalizeName(body.last_name);
    const recoveryPhrase = String(body.recovery_phrase || '').trim();

    const recoveryLimit = await enforceRateLimit({
      request,
      policy: 'auth_recovery',
      subject: `recover:phrase:${getClientIp(request)}:${normalizedKey(firstName, lastName) || 'missing'}`,
      metadata: { method: 'phrase' },
    });
    if (recoveryLimit) return recoveryLimit;

    if (!firstName || !lastName || !recoveryPhrase) {
      await writeAuditLog({ request, action: 'auth.recover.phrase', status: 'failed', metadata: { reason: 'missing_fields', firstName, lastName } });
      return NextResponse.json({ error: 'Введите имя, фамилию и recovery-фразу.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { normalizedKey: normalizedKey(firstName, lastName) } });
    if (!user) {
      await writeAuditLog({ request, action: 'auth.recover.phrase', status: 'failed', metadata: { reason: 'user_not_found', normalizedKey: normalizedKey(firstName, lastName) } });
      return NextResponse.json({ error: 'Пользователь не найден.' }, { status: 404 });
    }

    const verification = await verifyRecoveryMethod(user, 'recovery_phrase', { recovery_phrase: recoveryPhrase });
    if (!verification.ok) {
      await writeAuditLog({ request, actorUserId: user.id, action: 'auth.recover.phrase', status: 'failed', metadata: { reason: verification.reason } });
      return NextResponse.json({ error: 'Recovery-фраза не подошла.' }, { status: 401 });
    }

    await revokeUserSessionsForRecovery(user.id);
    const { plainToken, session } = await createSessionForUser(user.id, request);
    const response = NextResponse.json({
      message: 'Доступ восстановлен.',
      user: { id: user.id, first_name: user.firstName, last_name: user.lastName, created_at: user.createdAt },
    });
    applySessionCookie(response, plainToken, session.expiresAt);
    ensureCsrfCookie(response, request);
    await writeAuditLog({ request, session, action: 'auth.recover.phrase', entityType: 'session', entityId: session.id });
    return response;
  } catch (error) {
    console.error('recover/phrase failed', error);
    await writeAuditLog({ request, action: 'auth.recover.phrase', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось восстановить доступ.' }, { status: 500 });
  }
}

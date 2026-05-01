import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { updateUserDevicePin } from '@/lib/devices';
import { writeAuditLog } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/anti-abuse';
import { requirePasswordConfirmation } from '@/lib/sensitive-actions';

export async function PUT(request, { params }) {
  let auditSession = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    auditSession = session;
    if (!session) {
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    const sensitiveLimit = await enforceRateLimit({ request, policy: 'device_sensitive', actorUserId: session.user.id, subject: `device-pin:${session.user.id}` });
    if (sensitiveLimit) return sensitiveLimit;

    await touchSession(session.id);
    const body = await request.json().catch(() => ({}));
    const passwordGate = await requirePasswordConfirmation({ request, session, password: body.password, action: 'device.pin.update.confirm' });
    if (passwordGate) return passwordGate;
    const resolvedParams = await params;
    await updateUserDevicePin(session.userId, resolvedParams.deviceId, body.pin);

    await writeAuditLog({
      request,
      session,
      action: 'device.pin.update',
      entityType: 'device',
      entityId: resolvedParams.deviceId,
    });

    return NextResponse.json({ message: 'PIN устройства обновлён.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('devices/pin failed', error);
    await writeAuditLog({
      request,
      session: auditSession,
      action: 'device.pin.update',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    const status = Number(error?.status) || 500;
    return NextResponse.json({ error: error?.message || 'Не удалось обновить PIN устройства.' }, { status });
  }
}

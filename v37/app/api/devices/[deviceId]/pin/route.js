import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { updateUserDevicePin } from '@/lib/devices';
import { writeAuditLog } from '@/lib/audit';

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

    await touchSession(session.id);
    const body = await request.json();
    const resolvedParams = await params;
    await updateUserDevicePin(session.userId, resolvedParams.deviceId, body.pin);

    await writeAuditLog({
      request,
      session,
      action: 'device.pin.update',
      entityType: 'device',
      entityId: resolvedParams.deviceId,
    });

    return NextResponse.json({ message: 'PIN устройства обновлён.' });
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

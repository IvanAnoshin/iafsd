import { NextResponse } from 'next/server';
import { clearSessionCookie, getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { deleteUserDevice, getUserDevice } from '@/lib/devices';
import { writeAuditLog } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/anti-abuse';
import { requirePasswordConfirmation } from '@/lib/sensitive-actions';

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    await touchSession(session.id);
    const resolvedParams = await params;
    const device = await getUserDevice(session.userId, resolvedParams.deviceId, session);
    if (!device) {
      return NextResponse.json({ error: 'Устройство не найдено.' }, { status: 404 });
    }

    return NextResponse.json({ device }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('devices/get failed', error);
    return NextResponse.json({ error: 'Не удалось получить устройство.' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  let auditSession = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    auditSession = session;
    if (!session) {
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    const sensitiveLimit = await enforceRateLimit({ request, policy: 'device_sensitive', actorUserId: session.user.id, subject: `device-delete:${session.user.id}` });
    if (sensitiveLimit) return sensitiveLimit;

    await touchSession(session.id);
    const body = await request.json().catch(() => ({}));
    const passwordGate = await requirePasswordConfirmation({ request, session, password: body.password, action: 'device.delete.confirm' });
    if (passwordGate) return passwordGate;

    const resolvedParams = await params;
    const removed = await deleteUserDevice(session.userId, resolvedParams.deviceId);

    await writeAuditLog({
      request,
      session,
      action: 'device.delete',
      entityType: 'device',
      entityId: resolvedParams.deviceId,
      metadata: { label: removed.label },
    });

    const response = NextResponse.json({
      message: 'Устройство отключено.',
      removed: { id: removed.id, label: removed.label },
    });

    if (session.deviceFingerprint && removed?.fingerprint && session.deviceFingerprint === removed.fingerprint) {
      clearSessionCookie(response);
    }

    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error('devices/delete failed', error);
    await writeAuditLog({
      request,
      session: auditSession,
      action: 'device.delete',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    const status = Number(error?.status) || 500;
    return NextResponse.json({ error: error?.message || 'Не удалось отключить устройство.' }, { status });
  }
}

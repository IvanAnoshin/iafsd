import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { attachSessionToDevice, listUserDevices } from '@/lib/devices';

export async function GET(request) {
  try {
    let session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    await touchSession(session.id);

    if (!session.deviceFingerprint) {
      try {
        await attachSessionToDevice({ sessionId: session.id, userId: session.userId, request });
        session = await getCurrentSession();
      } catch (deviceError) {
        console.error('devices/backfill current failed', deviceError);
      }
    }

    const items = await listUserDevices(session.userId, session);

    return NextResponse.json({ items });
  } catch (error) {
    console.error('devices/list failed', error);
    return NextResponse.json({ error: 'Не удалось получить список устройств.' }, { status: 500 });
  }
}

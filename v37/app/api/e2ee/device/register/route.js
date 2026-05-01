import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { registerE2EEDevice, getUserE2EEStatus } from '@/lib/e2ee';

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const body = await request.json().catch(() => ({}));
    const device = await registerE2EEDevice(session.user.id, body);
    const status = await getUserE2EEStatus(session.user.id);
    return NextResponse.json({ device, status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('e2ee device register failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось зарегистрировать защищённое устройство.' }, { status: error?.status || 500 });
  }
}

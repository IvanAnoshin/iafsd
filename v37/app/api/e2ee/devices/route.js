import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { listE2EEDevices } from '@/lib/e2ee';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const items = await listE2EEDevices(session.user.id);
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('e2ee devices failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось получить список защищённых устройств.' }, { status: error?.status || 500 });
  }
}

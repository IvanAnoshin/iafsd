import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { getUserE2EEStatus } from '@/lib/e2ee';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const { searchParams } = new URL(request.url);
    const currentDeviceKeyId = searchParams.get('deviceKeyId') || '';
    const status = await getUserE2EEStatus(session.user.id, undefined, { currentDeviceKeyId });
    return NextResponse.json({ status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('e2ee status failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось получить статус защищённых чатов.' }, { status: error?.status || 500 });
  }
}

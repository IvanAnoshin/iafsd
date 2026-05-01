import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { getActiveE2EEBackup, saveE2EEBackup, getUserE2EEStatus, markActiveE2EEBackupRestored } from '@/lib/e2ee';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const backup = await getActiveE2EEBackup(session.user.id, undefined, { includeBlob: true });
    return NextResponse.json({ backup }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('e2ee backup get failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось получить recovery-файл.' }, { status: error?.status || 500 });
  }
}

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const body = await request.json().catch(() => ({}));
    if (body?.action === 'mark_restored') {
      const backup = await markActiveE2EEBackupRestored(session.user.id);
      const status = await getUserE2EEStatus(session.user.id);
      return NextResponse.json({ backup, status }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const backup = await saveE2EEBackup(session.user.id, body);
    const status = await getUserE2EEStatus(session.user.id);
    return NextResponse.json({ backup, status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('e2ee backup save failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось сохранить recovery-файл.' }, { status: error?.status || 500 });
  }
}

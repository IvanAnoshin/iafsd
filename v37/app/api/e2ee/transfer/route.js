import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import {
  listE2EETransferRequests,
  createE2EETransferRequest,
  approveE2EETransferRequest,
  completeE2EETransferRequest,
} from '@/lib/e2ee';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const { searchParams } = new URL(request.url);
    const deviceKeyId = searchParams.get('deviceKeyId') || '';
    const transfer = await listE2EETransferRequests(session.user.id, deviceKeyId);
    return NextResponse.json({ transfer }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('e2ee transfer list failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось получить статус переноса устройства.' }, { status: error?.status || 500 });
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
    const action = String(body?.action || '').trim();

    if (action === 'create_request') {
      const transferRequest = await createE2EETransferRequest(session.user, body);
      const transfer = await listE2EETransferRequests(session.user.id, body?.targetDeviceKeyId || '');
      return NextResponse.json({ transfer_request: transferRequest, transfer }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'approve_request') {
      const transferRequest = await approveE2EETransferRequest(session.user.id, body);
      const transfer = await listE2EETransferRequests(session.user.id, body?.approverDeviceKeyId || '');
      return NextResponse.json({ transfer_request: transferRequest, transfer }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'complete_request') {
      const transferRequest = await completeE2EETransferRequest(session.user.id, body);
      const transfer = await listE2EETransferRequests(session.user.id, body?.targetDeviceKeyId || '');
      return NextResponse.json({ transfer_request: transferRequest, transfer }, { headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({ error: 'Неизвестное действие переноса устройства.' }, { status: 400 });
  } catch (error) {
    console.error('e2ee transfer update failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось обновить перенос устройства.' }, { status: error?.status || 500 });
  }
}

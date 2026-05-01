import { NextResponse } from 'next/server';
import { requireAdminSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { updateAdminMessengerSafetyFlagStatus } from '@/lib/admin-moderation';

export async function PUT(request, { params }) {
  let session = null;
  const resolvedParams = await params;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await requireAdminSession();
    if (!session) return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const flag = await updateAdminMessengerSafetyFlagStatus(resolvedParams.id, body?.status || body?.global_status);
    await writeAuditLog({ request, session, action: 'admin.messenger_safety_flag.status', entityType: 'messenger_safety_flag', entityId: resolvedParams.id, metadata: { status: flag.status } });
    return NextResponse.json({ flag, message: 'Статус safety-флага обновлён.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('admin/safety-flags status failed', error);
    await writeAuditLog({ request, session, action: 'admin.messenger_safety_flag.status', entityType: 'messenger_safety_flag', entityId: resolvedParams?.id, status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: error?.message || 'Не удалось обновить safety-флаг.' }, { status: error?.status || 500 });
  }
}

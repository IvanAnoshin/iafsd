import { NextResponse } from 'next/server';
import { requireAdminSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { updateAdminSupportTicketStatus } from '@/lib/admin-moderation';

export async function PUT(request, { params }) {
  let session = null;
  const resolvedParams = await params;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await requireAdminSession();
    if (!session) return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const ticket = await updateAdminSupportTicketStatus(resolvedParams.id, body?.status);

    await writeAuditLog({ request, session, action: 'admin.support_ticket.status', entityType: 'support_ticket', entityId: resolvedParams.id, metadata: { status: ticket.status } });
    return NextResponse.json({ ticket, message: 'Статус тикета обновлён.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('admin/support/tickets status failed', error);
    await writeAuditLog({ request, session, action: 'admin.support_ticket.status', entityType: 'support_ticket', entityId: resolvedParams?.id, status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: error?.message || 'Не удалось обновить статус тикета.' }, { status: error?.status || 500 });
  }
}

import { NextResponse } from 'next/server';
import { requireAdminSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { updateAdminPostReportStatus } from '@/lib/admin-moderation';

export async function PUT(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await requireAdminSession();
    if (!session) return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const report = await updateAdminPostReportStatus(params.id, body?.status);

    await writeAuditLog({ request, session, action: 'admin.post_report.status', entityType: 'post_report', entityId: params.id, metadata: { status: report.status } });
    return NextResponse.json({ report, message: 'Статус жалобы обновлён.' });
  } catch (error) {
    console.error('admin/reports/posts status failed', error);
    await writeAuditLog({ request, session, action: 'admin.post_report.status', entityType: 'post_report', entityId: params?.id, status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: error?.message || 'Не удалось обновить статус жалобы.' }, { status: error?.status || 500 });
  }
}

import { NextResponse } from 'next/server';
import { requireAdminSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { updateAdminTargetReportStatus } from '@/lib/admin-moderation';

export async function PUT(request, { params }) {
  let session = null;
  const resolvedParams = await params;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await requireAdminSession();
    if (!session) return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const report = await updateAdminTargetReportStatus(resolvedParams.id, body?.status || body?.global_status);
    await writeAuditLog({ request, session, action: 'admin.target_report.status', entityType: 'target_report', entityId: resolvedParams.id, metadata: { status: report.status } });
    return NextResponse.json({ report, message: 'Статус жалобы обновлён.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('admin/reports/targets status failed', error);
    await writeAuditLog({ request, session, action: 'admin.target_report.status', entityType: 'target_report', entityId: resolvedParams?.id, status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: error?.message || 'Не удалось обновить статус жалобы.' }, { status: error?.status || 500 });
  }
}

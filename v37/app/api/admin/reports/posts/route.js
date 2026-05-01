import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { listAdminPostReports } from '@/lib/admin-moderation';

export async function GET(request) {
  let session = null;
  try {
    session = await requireAdminSession();
    if (!session) return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const payload = await listAdminPostReports({
      status: searchParams.get('status') || '',
      limit: searchParams.get('limit') || 20,
      offset: searchParams.get('offset') || 0,
    });

    await writeAuditLog({
      request,
      session,
      action: 'admin.post_reports.list',
      metadata: { status: searchParams.get('status') || '', limit: payload.limit, offset: payload.offset },
    });

    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('admin/reports/posts failed', error);
    await writeAuditLog({ request, session, action: 'admin.post_reports.list', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось загрузить жалобы.' }, { status: error?.status || 500 });
  }
}

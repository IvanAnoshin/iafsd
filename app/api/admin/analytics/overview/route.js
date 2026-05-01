import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { getAdminOverview } from '@/lib/admin';

export async function GET(request) {
  let session = null;
  try {
    session = await requireAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });
    }

    const overview = await getAdminOverview();
    await writeAuditLog({ request, session, action: 'admin.analytics.overview' });
    return NextResponse.json({ overview }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('admin/analytics/overview failed', error);
    await writeAuditLog({ request, session, action: 'admin.analytics.overview', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось загрузить admin analytics.' }, { status: 500 });
  }
}

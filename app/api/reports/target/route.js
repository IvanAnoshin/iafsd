import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createTargetReport } from '@/lib/reports';

export async function POST(request) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const body = await request.json().catch(() => ({}));
    const result = await createTargetReport(session.user.id, body || {});

    await writeAuditLog({
      request,
      session,
      action: 'target.report',
      entityType: result.report?.target_type || 'target',
      entityId: result.report?.target_id || null,
      metadata: { created: result.created, reportId: result.report?.id || null },
    });

    return NextResponse.json({
      ok: true,
      created: result.created,
      report: result.report,
      message: result.created ? 'Жалоба отправлена.' : 'Жалоба уже была отправлена раньше.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('target/report failed', error);
    await writeAuditLog({ request, session, action: 'target.report', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: error?.message || 'Не удалось отправить жалобу.' }, { status: error?.status || 500 });
  }
}

import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createPostReport } from '@/lib/reports';
import { enforceRateLimit } from '@/lib/anti-abuse';

export async function POST(request, { params }) {
  const csrf = verifyCsrf(request);
  if (!csrf.ok) return csrf.response;

  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

  const reportLimit = await enforceRateLimit({ request, policy: 'report_create', actorUserId: session.user.id });
  if (reportLimit) return reportLimit;

  try {
    await touchSession(session.id);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await createPostReport(session.user.id, id, body);
    await writeAuditLog({
      request,
      session,
      action: 'post.report.create',
      entityType: 'post_report',
      entityId: result.report?.id,
      metadata: { postId: Number(id), created: result.created, reason: result.report?.reason || body?.reason || null },
    });
    return NextResponse.json({
      report: result.report,
      created: result.created,
      message: result.created ? 'Жалоба отправлена.' : 'Жалоба уже была отправлена ранее.',
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    console.error('reports/posts post failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'post.report.create',
      status: 'error',
      metadata: { postId: Number((await params).id), message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: error?.message || 'Не удалось отправить жалобу.' }, { status: error?.status || 500 });
  }
}

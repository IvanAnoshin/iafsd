import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import prisma from '@/lib/prisma';
import { attachCommentViewerFlags, attachCommentVotes, commentInclude, serializeComment } from '@/lib/comments';
import { createCommentReport } from '@/lib/reports';
import { enforceRateLimit } from '@/lib/anti-abuse';

export async function POST(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const reportLimit = await enforceRateLimit({ request, policy: 'report_create', actorUserId: session.user.id });
    if (reportLimit) return reportLimit;

    const { commentId } = await params;
    const targetCommentId = Number(commentId);
    if (!Number.isFinite(targetCommentId) || targetCommentId <= 0) {
      return NextResponse.json({ error: 'Некорректный комментарий.' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const result = await createCommentReport(session.user.id, targetCommentId, body, prisma);

    const current = await prisma.comment.findUnique({
      where: { id: targetCommentId },
      include: commentInclude,
    });

    let comment = null;
    if (current) {
      let [hydrated] = await attachCommentVotes([current]);
      [hydrated] = await attachCommentViewerFlags([hydrated], session.user.id);
      comment = serializeComment(hydrated, session.user.id);
    }

    await writeAuditLog({
      request,
      session,
      action: 'comment.report',
      entityType: 'comment',
      entityId: targetCommentId,
      metadata: { created: result.created, moderationStatus: result.moderation_status || null },
    });

    return NextResponse.json({
      ok: true,
      created: result.created,
      report: result.report,
      comment,
      message: result.created ? 'Жалоба на комментарий отправлена.' : 'Жалоба уже была отправлена раньше.',
    });
  } catch (error) {
    console.error('comment/report failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'comment.report',
      entityType: 'comment',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: error?.message || 'Не удалось отправить жалобу на комментарий.' }, { status: error?.status || 500 });
  }
}

import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { reportMessage } from '@/lib/chat';
import { enforceRateLimit } from '@/lib/anti-abuse';

export async function POST(request, { params }) {
  let session = null;
  const messageId = (await params).id;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const reportLimit = await enforceRateLimit({ request, policy: 'report_create', actorUserId: session.user.id });
    if (reportLimit) return reportLimit;
    const body = await request.json().catch(() => ({}));
    const result = await reportMessage(session.user.id, messageId, body);
    await writeAuditLog({ request, session, action: 'chat.message.report', entityType: 'message', entityId: messageId, metadata: { reason: body?.reason || null, blockFutureMessages: Boolean(body?.blockFutureMessages || body?.block_future_messages), safetyFlagged: Boolean(result?.safety_flagged) } });
    return NextResponse.json(result, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat message report failed', error);
    await writeAuditLog({ request, session, action: 'chat.message.report', entityType: 'message', entityId: messageId, status: 'error', metadata: { error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось отправить жалобу.' }, { status: error?.status || 500 });
  }
}

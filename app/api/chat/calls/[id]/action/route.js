import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { applyCallAction } from '@/lib/chat-calls';
import { recordMessengerMetric } from '@/lib/chat-observability';

export async function POST(request, { params }) {
  let session = null;
  const startedAt = Date.now();
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const resolved = await params;
    const body = await request.json().catch(() => ({}));
    const call = await applyCallAction(session.user.id, resolved.id, body?.action, body);
    await writeAuditLog({ request, session, action: `chat.call.${String(body?.action || 'action')}`, entityType: 'call_session', entityId: String(call.id), metadata: { conversationId: call.conversation_id, status: call.status } });
    await recordMessengerMetric({
      userId: session.user.id,
      conversationId: call.conversation_id,
      callSessionId: call.id,
      category: 'call',
      metric: 'action',
      outcome: 'success',
      durationMs: Date.now() - startedAt,
      details: { action: String(body?.action || 'unknown'), status: call.status },
    });
    return NextResponse.json({ ok: true, call }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('call action failed', error);
    await recordMessengerMetric({
      userId: session?.user?.id || null,
      category: 'call',
      metric: 'action',
      outcome: 'error',
      durationMs: Date.now() - startedAt,
      details: { error: error?.message || String(error) },
    }).catch(() => null);
    return NextResponse.json({ error: error?.message || 'Не удалось обновить звонок.' }, { status: error?.status || 500 });
  }
}

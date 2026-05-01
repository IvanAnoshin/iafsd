import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createCallSession, listCallsForConversation } from '@/lib/chat-calls';
import { recordMessengerMetric } from '@/lib/chat-observability';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversation_id');
    if (!conversationId) return NextResponse.json({ error: 'Нужен conversation_id.' }, { status: 400 });
    const result = await listCallsForConversation(session.user.id, conversationId, { limit: Number(searchParams.get('limit') || 10) });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('call list failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось получить звонки.' }, { status: error?.status || 500 });
  }
}

export async function POST(request) {
  let session = null;
  const startedAt = Date.now();
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return NextResponse.json({ error: csrf.error }, { status: csrf.status });
    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const body = await request.json().catch(() => ({}));
    const call = await createCallSession(session.user.id, body?.conversation_id || body?.conversationId, { type: body?.type || 'audio' });
    await writeAuditLog({ request, session, action: 'chat.call.create', entityType: 'call_session', entityId: String(call.id), metadata: { conversationId: call.conversation_id, type: call.type } });
    await recordMessengerMetric({
      userId: session.user.id,
      conversationId: call.conversation_id,
      callSessionId: call.id,
      category: 'call',
      metric: 'create',
      outcome: 'success',
      durationMs: Date.now() - startedAt,
      details: { type: call.type },
    });
    return NextResponse.json({ ok: true, call }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('call create failed', error);
    await recordMessengerMetric({
      userId: session?.user?.id || null,
      category: 'call',
      metric: 'create',
      outcome: 'error',
      durationMs: Date.now() - startedAt,
      details: { error: error?.message || String(error) },
    }).catch(() => null);
    return NextResponse.json({ error: error?.message || 'Не удалось начать звонок.' }, { status: error?.status || 500 });
  }
}

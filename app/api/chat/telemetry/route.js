import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { recordMessengerMetrics } from '@/lib/chat-observability';

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const body = await request.json().catch(() => ({}));
    const sourceEvents = Array.isArray(body?.events) ? body.events : body ? [body] : [];
    const events = sourceEvents.slice(0, 50).map((item) => ({
      ...item,
      userId: session.user.id,
      conversationId: item?.conversationId || item?.conversation_id || null,
      callSessionId: item?.callSessionId || item?.call_session_id || null,
    }));
    const result = await recordMessengerMetrics(events);
    return NextResponse.json({ ok: true, count: result.count }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat telemetry failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось сохранить метрики мессенджера.' }, { status: error?.status || 500 });
  }
}

import { NextResponse } from 'next/server';
import { heartbeatPresence } from '@/lib/chat';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return NextResponse.json({ error: csrf.error }, { status: csrf.status });
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const body = await request.json().catch(() => ({}));
    const presence = await heartbeatPresence(session.user.id, {
      source: body?.source || 'heartbeat',
      conversationId: body?.conversation_id || body?.conversationId || null,
    });
    return NextResponse.json({ ok: true, presence }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('presence heartbeat failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось обновить присутствие.' }, { status: error?.status || 500 });
  }
}

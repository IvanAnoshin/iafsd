import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { pushCallSignal } from '@/lib/chat-calls';

export async function POST(request, { params }) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const resolved = await params;
    const body = await request.json().catch(() => ({}));
    const result = await pushCallSignal(session.user.id, resolved.id, body?.signal_type || body?.type, body?.payload || body?.data || {});
    await writeAuditLog({ request, session, action: `chat.call.signal.${String(body?.signal_type || body?.type || 'unknown')}`, entityType: 'call_session', entityId: String(resolved.id), metadata: { conversationId: body?.conversation_id || null } });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('call signal failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось отправить сигнал звонка.' }, { status: error?.status || 500 });
  }
}

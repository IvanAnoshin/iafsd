import { NextResponse } from 'next/server';
import { acceptMessageRequest } from '@/lib/chat';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request, { params }) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return NextResponse.json({ error: csrf.error }, { status: csrf.status });
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const resolved = await params;
    const record = await acceptMessageRequest(session.user.id, resolved.id);
    await writeAuditLog({ request, session, action: 'chat.request.accept', entityType: 'message_request', entityId: String(record.id), metadata: { conversationId: record.conversationId } });
    return NextResponse.json({ ok: true, request: record }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('message request accept failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось принять запрос.' }, { status: error?.status || 500 });
  }
}

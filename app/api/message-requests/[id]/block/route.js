import { NextResponse } from 'next/server';
import { rejectMessageRequest } from '@/lib/chat';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request, { params }) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const resolved = await params;
    const record = await rejectMessageRequest(session.user.id, resolved.id, 'blocked');
    await writeAuditLog({ request, session, action: 'chat.request.block', entityType: 'message_request', entityId: String(record.id), metadata: { conversationId: record.conversationId } });
    return NextResponse.json({ ok: true, request: record }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('message request block failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось заблокировать запрос.' }, { status: error?.status || 500 });
  }
}

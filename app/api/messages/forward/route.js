import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { forwardMessages } from '@/lib/chat';

export async function POST(request) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const body = await request.json();
    const result = await forwardMessages(session.user.id, body);
    await writeAuditLog({
      request,
      session,
      action: 'chat.message.forward',
      entityType: 'message',
      metadata: {
        messageIds: Array.isArray(body?.messageIds) ? body.messageIds : Array.isArray(body?.message_ids) ? body.message_ids : [],
        conversationIds: Array.isArray(body?.conversationIds) ? body.conversationIds : Array.isArray(body?.conversation_ids) ? body.conversation_ids : [],
        commentLength: String(body?.comment || '').trim().length,
      },
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat message forward failed', error);
    await writeAuditLog({ request, session, action: 'chat.message.forward', status: 'error', metadata: { error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось переслать сообщение.' }, { status: error?.status || 500 });
  }
}

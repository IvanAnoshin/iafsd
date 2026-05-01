import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { setConversationPinned } from '@/lib/chat';

export async function POST(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const body = await request.json().catch(() => ({}));
    const conversationId = (await params).id;
    const enabled = body?.enabled !== false;
    const conversation = await setConversationPinned(session.user.id, conversationId, enabled);
    await writeAuditLog({ request, session, action: 'chat.pin', entityType: 'conversation', entityId: conversationId, metadata: { enabled } });
    return NextResponse.json({ conversation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('pin conversation failed', error);
    await writeAuditLog({ request, session, action: 'chat.pin', status: 'error', metadata: { error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось изменить закрепление диалога.' }, { status: error?.status || 500 });
  }
}

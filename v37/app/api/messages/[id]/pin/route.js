import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { setMessagePinned } from '@/lib/chat';

export async function POST(request, { params }) {
  let session = null;
  const messageId = (await params).id;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const message = await setMessagePinned(session.user.id, messageId, true);
    await writeAuditLog({ request, session, action: 'chat.message.pin', entityType: 'message', entityId: messageId });
    return NextResponse.json({ message }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat message pin failed', error);
    await writeAuditLog({ request, session, action: 'chat.message.pin', entityType: 'message', entityId: messageId, status: 'error', metadata: { error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось закрепить сообщение.' }, { status: error?.status || 500 });
  }
}

export async function DELETE(request, { params }) {
  let session = null;
  const messageId = (await params).id;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const message = await setMessagePinned(session.user.id, messageId, false);
    await writeAuditLog({ request, session, action: 'chat.message.unpin', entityType: 'message', entityId: messageId });
    return NextResponse.json({ message }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat message unpin failed', error);
    await writeAuditLog({ request, session, action: 'chat.message.unpin', entityType: 'message', entityId: messageId, status: 'error', metadata: { error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось открепить сообщение.' }, { status: error?.status || 500 });
  }
}

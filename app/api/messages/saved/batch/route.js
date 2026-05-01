import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { removeSavedMessagesForUser } from '@/lib/chat';

export async function DELETE(request) {
  let session = null;
  let messageIds = [];
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const body = await request.json().catch(() => ({}));
    messageIds = Array.isArray(body?.messageIds) ? body.messageIds : [];
    const result = await removeSavedMessagesForUser(session.user.id, messageIds);
    await writeAuditLog({
      request,
      session,
      action: 'chat.message.unsave.batch',
      entityType: 'message',
      entityId: result.messageIds.join(','),
      metadata: { removedCount: result.removedCount },
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('batch unsave saved messages failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'chat.message.unsave.batch',
      entityType: 'message',
      entityId: Array.isArray(messageIds) ? messageIds.join(',') : '',
      status: 'error',
      metadata: { error: error?.message || String(error) },
    });
    return NextResponse.json({ error: error?.message || 'Не удалось убрать сообщения из сохранённых.' }, { status: error?.status || 500 });
  }
}

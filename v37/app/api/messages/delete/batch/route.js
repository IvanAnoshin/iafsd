import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { deleteMessagesBatch } from '@/lib/chat';

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
    const result = await deleteMessagesBatch(session.user.id, messageIds);
    await writeAuditLog({
      request,
      session,
      action: 'chat.message.delete.batch',
      entityType: 'message',
      entityId: result.messages.map((item) => item.id).join(','),
      metadata: { deletedCount: result.deletedCount, failedCount: Array.isArray(result.failed) ? result.failed.length : 0 },
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat message delete batch failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'chat.message.delete.batch',
      entityType: 'message',
      entityId: Array.isArray(messageIds) ? messageIds.join(',') : '',
      status: 'error',
      metadata: { error: error?.message || String(error) },
    });
    return NextResponse.json({ error: error?.message || 'Не удалось удалить выбранные сообщения.' }, { status: error?.status || 500 });
  }
}

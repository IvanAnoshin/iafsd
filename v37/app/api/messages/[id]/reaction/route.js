import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { toggleMessageReaction } from '@/lib/chat';

export async function POST(request, { params }) {
  let session = null;
  const messageId = (await params).id;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const body = await request.json().catch(() => ({}));
    const message = await toggleMessageReaction(session.user.id, messageId, body?.emoji || '❤️');
    await writeAuditLog({ request, session, action: 'chat.message.react', entityType: 'message', entityId: messageId, metadata: { emoji: body?.emoji || '❤️' } });
    return NextResponse.json({ message }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat message react failed', error);
    await writeAuditLog({ request, session, action: 'chat.message.react', entityType: 'message', entityId: messageId, status: 'error', metadata: { error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось обновить реакцию.' }, { status: error?.status || 500 });
  }
}

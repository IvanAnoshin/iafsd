import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createOrOpenDirectConversation } from '@/lib/chat';

export async function POST(request) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const body = await request.json();
    const targetUserId = Number(body.target_user_id || body.targetUserId);
    const conversation = await createOrOpenDirectConversation(session.user.id, targetUserId);
    await writeAuditLog({ request, session, action: 'chat.direct.open', entityType: 'conversation', entityId: conversation.id, metadata: { targetUserId } });
    return NextResponse.json({ conversation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('direct chat open failed', error);
    await writeAuditLog({ request, session, action: 'chat.direct.open', status: 'error', metadata: { error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось открыть диалог.' }, { status: error?.status || 500 });
  }
}

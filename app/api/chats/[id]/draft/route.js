import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { clearDraftForConversation, setDraftForConversation } from '@/lib/chat';

export async function PUT(request, { params }) {
  let session = null;
  const conversationId = (await params).id;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const body = await request.json();
    const result = await setDraftForConversation(session.user.id, conversationId, body?.text || body?.draftText || '');
    await writeAuditLog({ request, session, action: 'chat.draft.set', entityType: 'conversation', entityId: conversationId, metadata: { length: String(result.draftText || '').length } });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat draft set failed', error);
    await writeAuditLog({ request, session, action: 'chat.draft.set', entityType: 'conversation', entityId: conversationId, status: 'error', metadata: { error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось сохранить черновик.' }, { status: error?.status || 500 });
  }
}

export async function DELETE(request, { params }) {
  let session = null;
  const conversationId = (await params).id;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const result = await clearDraftForConversation(session.user.id, conversationId);
    await writeAuditLog({ request, session, action: 'chat.draft.clear', entityType: 'conversation', entityId: conversationId });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat draft clear failed', error);
    await writeAuditLog({ request, session, action: 'chat.draft.clear', entityType: 'conversation', entityId: conversationId, status: 'error', metadata: { error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось очистить черновик.' }, { status: error?.status || 500 });
  }
}

import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { getMessagesForConversation, sendMessageToConversation } from '@/lib/chat';
import { recordMessengerMetric } from '@/lib/chat-observability';
import { enforceRateLimit } from '@/lib/anti-abuse';
import { ensureUserNotRestricted } from '@/lib/moderation-enforcement';

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') || 40);
    const cursor = searchParams.get('cursor') || '';
    const conversationId = (await params).id;
    const result = await getMessagesForConversation(session.user.id, conversationId, { limit, cursor });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat messages get failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось загрузить сообщения.' }, { status: error?.status || 500 });
  }
}

export async function POST(request, { params }) {
  let session = null;
  const startedAt = Date.now();
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    await ensureUserNotRestricted(session.user.id, 'chat');
    const messageLimit = await enforceRateLimit({ request, policy: 'chat_message_send', actorUserId: session.user.id });
    if (messageLimit) return messageLimit;
    const body = await request.json();
    const conversationId = (await params).id;
    const message = await sendMessageToConversation(session.user.id, conversationId, body);
    await writeAuditLog({ request, session, action: 'chat.message.send', entityType: 'conversation', entityId: conversationId, metadata: { messageId: message.id, clientId: body?.clientId || body?.client_id || null, length: String(body.text || '').trim().length } });
    await recordMessengerMetric({
      userId: session.user.id,
      conversationId,
      category: 'message',
      metric: 'send',
      outcome: 'success',
      durationMs: Date.now() - startedAt,
      details: { type: body?.message_type || body?.type || message?.type || 'text', hasMedia: Boolean(body?.media || message?.media_url) },
    });
    return NextResponse.json({ message }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat message send failed', error);
    const resolvedParams = await params;
    await recordMessengerMetric({
      userId: session?.user?.id || null,
      conversationId: resolvedParams?.id || null,
      category: 'message',
      metric: 'send',
      outcome: 'error',
      durationMs: Date.now() - startedAt,
      details: { error: error?.message || String(error) },
    }).catch(() => null);
    await writeAuditLog({ request, session, action: 'chat.message.send', status: 'error', metadata: { error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось отправить сообщение.' }, { status: error?.status || 500 });
  }
}

import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { getConversationE2EERecipients } from '@/lib/e2ee';

export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const conversationId = (await params).id;
    const payload = await getConversationE2EERecipients(session.user.id, conversationId);
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat e2ee recipients failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось получить ключи участников чата.' }, { status: error?.status || 500 });
  }
}

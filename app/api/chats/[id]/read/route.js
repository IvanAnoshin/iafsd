import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { markConversationRead } from '@/lib/chat';

export async function POST(request, { params }) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const conversationId = (await params).id;
    const result = await markConversationRead(session.user.id, conversationId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat mark read failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось отметить диалог прочитанным.' }, { status: error?.status || 500 });
  }
}

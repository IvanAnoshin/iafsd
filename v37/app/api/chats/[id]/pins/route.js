import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { listPinnedMessages } from '@/lib/chat';

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const conversationId = (await params).id;
    const result = await listPinnedMessages(session.user.id, conversationId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat pins failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось загрузить закрепы.' }, { status: error?.status || 500 });
  }
}

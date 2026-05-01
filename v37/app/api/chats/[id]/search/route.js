import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { searchConversationMessages } from '@/lib/chat';

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const { searchParams } = new URL(request.url);
    const conversationId = (await params).id;
    const result = await searchConversationMessages(session.user.id, conversationId, {
      query: searchParams.get('q') || searchParams.get('query') || '',
      type: searchParams.get('type') || '',
      cursor: searchParams.get('cursor') || '',
      limit: Number(searchParams.get('limit') || 20),
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chat search failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось выполнить поиск по переписке.' }, { status: error?.status || 500 });
  }
}

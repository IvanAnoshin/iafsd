import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { listChatsForUser } from '@/lib/chat';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') || 30);
    const query = searchParams.get('q') || searchParams.get('query') || '';
    const scope = searchParams.get('scope') || 'active';
    const result = await listChatsForUser(session.user.id, { limit, query, scope });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('chats list failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось загрузить чаты.' }, { status: error?.status || 500 });
  }
}

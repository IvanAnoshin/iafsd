import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { listSavedMessages } from '@/lib/chat';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const { searchParams } = new URL(request.url);
    const result = await listSavedMessages(session.user.id, {
      query: searchParams.get('q') || searchParams.get('query') || '',
      type: searchParams.get('type') || '',
      cursor: searchParams.get('cursor') || '',
      limit: Number(searchParams.get('limit') || 24),
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('saved messages list failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось загрузить сохранённые сообщения.' }, { status: error?.status || 500 });
  }
}

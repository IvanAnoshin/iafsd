import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { listMessageRequestsForUser } from '@/lib/chat';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') || 20);
    const result = await listMessageRequestsForUser(session.user.id, { limit });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('message requests failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось загрузить запросы на переписку.' }, { status: error?.status || 500 });
  }
}

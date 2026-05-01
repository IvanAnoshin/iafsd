import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { searchUsers } from '@/lib/search';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || searchParams.get('query') || '';
    const limit = Math.min(25, Math.max(1, Number(searchParams.get('limit') || 12) || 12));
    const includeCurrentUser = String(searchParams.get('include_self') || '').toLowerCase() === 'true';

    const result = await searchUsers(session.user.id, query, { limit, includeCurrentUser });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('search/users failed', error);
    return NextResponse.json({ error: 'Не удалось выполнить поиск пользователей.' }, { status: 500 });
  }
}

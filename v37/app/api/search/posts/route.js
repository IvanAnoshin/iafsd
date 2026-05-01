import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { searchPosts } from '@/lib/search';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || searchParams.get('query') || '';
    const limit = Math.min(30, Math.max(1, Number(searchParams.get('limit') || 18) || 18));

    const result = await searchPosts(session.user.id, query, { limit });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('search/posts failed', error);
    return NextResponse.json({ error: 'Не удалось выполнить поиск публикаций.' }, { status: 500 });
  }
}

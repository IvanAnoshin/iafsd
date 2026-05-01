import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { searchCommunities, searchPosts, searchUsers } from '@/lib/search';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || searchParams.get('query') || '';
    const scope = String(searchParams.get('scope') || 'all').toLowerCase();

    if (scope === 'users') {
      return NextResponse.json(await searchUsers(session.user.id, query), { headers: { 'Cache-Control': 'no-store' } });
    }
    if (scope === 'posts') {
      return NextResponse.json(await searchPosts(session.user.id, query), { headers: { 'Cache-Control': 'no-store' } });
    }
    if (scope === 'communities') {
      return NextResponse.json(await searchCommunities(session.user.id, query), { headers: { 'Cache-Control': 'no-store' } });
    }

    const [users, posts, communities] = await Promise.all([
      searchUsers(session.user.id, query, { limit: 8 }),
      searchPosts(session.user.id, query, { limit: 8 }),
      searchCommunities(session.user.id, query),
    ]);

    return NextResponse.json({
      query: users.query,
      users: users.users,
      posts: posts.posts,
      communities: communities.communities,
      totals: {
        users: users.users.length,
        posts: posts.posts.length,
        communities: communities.communities.length,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('search/all failed', error);
    return NextResponse.json({ error: 'Не удалось выполнить поиск.' }, { status: 500 });
  }
}

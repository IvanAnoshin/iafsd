import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createCommunityPost, listCommunityPosts } from '@/lib/communities';
import { enforceRateLimit } from '@/lib/anti-abuse';
import { ensureUserNotRestricted } from '@/lib/moderation-enforcement';

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);


    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || 30;
    const cursor = searchParams.get('cursor') || '';
    const result = await listCommunityPosts(slug, session.user.id, { limit, cursor });

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.warn('communities/posts fallback enabled', error?.message || error);
    const status = error?.status || 500;
    if (status !== 500) {
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({
      posts: [],
      page: { has_more: false, next_cursor: null },
      degraded: true,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function POST(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    await ensureUserNotRestricted(session.user.id, 'community');

    const postLimit = await enforceRateLimit({ request, policy: 'community_post_create', actorUserId: session.user.id });
    if (postLimit) return postLimit;

    const { slug } = await params;
    const payload = await request.json().catch(() => ({}));
    const post = await createCommunityPost(slug, session.user.id, payload || {});

    await writeAuditLog({
      request,
      session,
      action: 'community.post.create',
      entityType: 'post',
      entityId: String(post.id),
      metadata: { slug, length: String(payload?.text || '').trim().length },
    }).catch(() => null);

    return NextResponse.json({ message: 'Пост опубликован в сообществе.', post }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/post create failed', error);
    await writeAuditLog({ request, session, action: 'community.post.create', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось опубликовать пост.' : error.message }, { status });
  }
}

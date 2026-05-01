import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { createStoryFoundation, listStoriesFoundation } from '@/lib/stories';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const { searchParams } = new URL(request.url);
    const payload = await listStoriesFoundation(session.user.id, {
      source: searchParams.get('source') || 'stories',
      userId: searchParams.get('user_id') || searchParams.get('user') || null,
      storyId: searchParams.get('story_id') || searchParams.get('story') || null,
      includeExpired: searchParams.get('include_expired') === '1',
      limit: searchParams.get('limit') || 12,
    });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('stories list failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось загрузить момент.' }, { status: error?.status || 500 });
  }
}

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return NextResponse.json({ error: csrf.error }, { status: csrf.status });
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const body = await request.json().catch(() => ({}));
    const story = await createStoryFoundation(session.user.id, body);
    return NextResponse.json({ ok: true, story }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('story create failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось создать момент.' }, { status: error?.status || 500 });
  }
}

import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { toggleStoryReactionFoundation } from '@/lib/stories';

export async function POST(request, context) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return NextResponse.json({ error: csrf.error }, { status: csrf.status });
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const body = await request.json().catch(() => ({}));
    const params = await context?.params;
    const storyId = String(params?.id || '').trim();
    const story = await toggleStoryReactionFoundation(session.user.id, storyId, body);
    return NextResponse.json({ ok: true, story }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('story reaction failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось оценить момент.' }, { status: error?.status || 500 });
  }
}

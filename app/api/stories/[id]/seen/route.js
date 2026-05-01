import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { markStorySeenFoundation } from '@/lib/stories';

export async function POST(request, context) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const params = await context?.params;
    const storyId = String(params?.id || '').trim();
    if (!storyId) return NextResponse.json({ ok: true, story: null }, { headers: { 'Cache-Control': 'no-store' } });
    try {
      const story = await markStorySeenFoundation(session.user.id, storyId);
      return NextResponse.json({ ok: true, story }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error?.status === 404) {
        return NextResponse.json({ ok: true, story: null }, { headers: { 'Cache-Control': 'no-store' } });
      }
      throw error;
    }
  } catch (error) {
    console.error('story seen failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось отметить момент просмотренной.' }, { status: error?.status || 500 });
  }
}

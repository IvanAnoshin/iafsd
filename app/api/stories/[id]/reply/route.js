import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { replyToStoryFoundation } from '@/lib/stories';

export async function POST(request, context) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const params = await context?.params;
    const body = await request.json().catch(() => ({}));
    const result = await replyToStoryFoundation(session.user.id, params?.id, body);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('story reply failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось ответить на момент.' }, { status: error?.status || 500 });
  }
}

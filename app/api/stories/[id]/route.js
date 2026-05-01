import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { deleteStoryFoundation } from '@/lib/stories';

export async function DELETE(request, context) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const params = await context?.params;
    const result = await deleteStoryFoundation(session.user.id, params?.id);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('story delete failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось удалить момент.' }, { status: error?.status || 500 });
  }
}

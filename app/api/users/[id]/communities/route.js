import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { listProfileCommunities } from '@/lib/communities';

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const result = await listProfileCommunities(Number(id), session.user.id, { limit: searchParams.get('limit') || 8 });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('users/communities failed', error);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось загрузить сообщества профиля.' : error.message }, { status });
  }
}

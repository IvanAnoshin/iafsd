import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { getCallSession } from '@/lib/chat-calls';

export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const resolved = await params;
    const call = await getCallSession(session.user.id, resolved.id);
    return NextResponse.json({ call }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('call get failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось получить звонок.' }, { status: error?.status || 500 });
  }
}

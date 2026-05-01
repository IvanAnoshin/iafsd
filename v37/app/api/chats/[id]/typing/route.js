import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { getTypingSnapshotForConversation, updateTypingForConversation } from '@/lib/chat';

export async function POST(request, { params }) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return NextResponse.json({ error: csrf.error }, { status: csrf.status });
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const resolved = await params;
    const body = await request.json().catch(() => ({}));
    const state = await updateTypingForConversation(session.user.id, resolved.id, Boolean(body?.typing));
    return NextResponse.json({ ok: true, state }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('typing update failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось обновить статус набора.' }, { status: error?.status || 500 });
  }
}


export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const resolved = await params;
    const items = await getTypingSnapshotForConversation(session.user.id, resolved.id);
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('typing snapshot failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось получить статус набора.' }, { status: error?.status || 500 });
  }
}

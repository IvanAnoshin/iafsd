import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { getUnreadSummary } from '@/lib/realtime-sync';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);

    const summary = await getUnreadSummary(session.user.id);
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('realtime unread summary failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить сводку непрочитанных.' }, { status: 500 });
  }
}

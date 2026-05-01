import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { getMessageContext } from '@/lib/chat';

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const { searchParams } = new URL(request.url);
    const messageId = (await params).id;
    const result = await getMessageContext(session.user.id, messageId, {
      before: Number(searchParams.get('before') || 12),
      after: Number(searchParams.get('after') || 12),
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('message context failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось открыть сообщение в контексте.' }, { status: error?.status || 500 });
  }
}

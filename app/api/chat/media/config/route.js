import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { getChatMediaConfig, serializeChatMediaConfig } from '@/lib/chat-media';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    return NextResponse.json(serializeChatMediaConfig(getChatMediaConfig()), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('chat media config failed', error);
    return NextResponse.json({ error: 'Не удалось получить конфигурацию загрузки для чата.' }, { status: 500 });
  }
}

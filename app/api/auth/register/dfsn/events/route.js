import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export async function POST(request) {
  try {
    const body = await request.json();
    const sessionId = String(body.dfsn_session_id || '').trim();

    if (!sessionId) {
      return NextResponse.json({ error: 'DFSN-сессия не найдена.' }, { status: 400 });
    }

    const session = await prisma.dfsnSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        typingEvents: true,
        mouseEvents: true,
        scrollEvents: true,
      },
    });

    if (!session) {
      return NextResponse.json({ error: 'DFSN-сессия не найдена.' }, { status: 404 });
    }

    const typingEvents = [...asArray(session.typingEvents), ...asArray(body.typing_events)];
    const mouseEvents = [...asArray(session.mouseEvents), ...asArray(body.mouse_events)];
    const scrollEvents = [...asArray(session.scrollEvents), ...asArray(body.scroll_events)];

    await prisma.dfsnSession.update({
      where: { id: sessionId },
      data: {
        typingEvents,
        mouseEvents,
        scrollEvents,
      },
    });

    return NextResponse.json({ message: 'DFSN events saved.' });
  } catch (error) {
    console.error('register/dfsn/events failed', error);
    return NextResponse.json({ error: 'Не удалось сохранить DFSN-события.' }, { status: 500 });
  }
}

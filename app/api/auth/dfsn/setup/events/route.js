import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';

function asArray(value, limit = 500) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    await touchSession(session.id);

    const body = await request.json();
    const sessionId = String(body.dfsn_session_id || '').trim();

    if (!sessionId) {
      return NextResponse.json({ error: 'DFSN-сессия не найдена.' }, { status: 400 });
    }

    const dfsnSession = await prisma.dfsnSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        phase: true,
        endedAt: true,
        typingEvents: true,
        mouseEvents: true,
        scrollEvents: true,
      },
    });

    if (!dfsnSession || dfsnSession.userId !== session.userId || dfsnSession.phase !== 'setup') {
      return NextResponse.json({ error: 'DFSN-сессия не найдена.' }, { status: 404 });
    }

    if (dfsnSession.endedAt) {
      return NextResponse.json({ error: 'DFSN-сессия уже завершена.' }, { status: 409 });
    }

    await prisma.dfsnSession.update({
      where: { id: sessionId },
      data: {
        typingEvents: [...asArray(dfsnSession.typingEvents, 1200), ...asArray(body.typing_events, 700)].slice(-1200),
        mouseEvents: [...asArray(dfsnSession.mouseEvents, 1200), ...asArray(body.mouse_events, 700)].slice(-1200),
        scrollEvents: [...asArray(dfsnSession.scrollEvents, 600), ...asArray(body.scroll_events, 300)].slice(-600),
      },
    });

    return NextResponse.json({ message: 'DFSN events saved.' });
  } catch (error) {
    console.error('auth/dfsn/setup/events failed', error);
    return NextResponse.json({ error: 'Не удалось сохранить DFSN-события.' }, { status: 500 });
  }
}

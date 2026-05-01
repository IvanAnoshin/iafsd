import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';

export async function POST(_request, { params }) {
  try {
    const threadId = Number((await params).id);
    const session = await getCurrentSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Необходима авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const participant = await prisma.chatParticipant.findUnique({
      where: {
        threadId_userId: {
          threadId,
          userId: session.user.id,
        },
      },
    });

    if (!participant) {
      return NextResponse.json({ error: 'Диалог не найден.' }, { status: 404 });
    }

    await prisma.chatMessage.deleteMany({ where: { threadId } });
    await prisma.chatParticipant.updateMany({
      where: { threadId },
      data: { unreadCount: 0, lastReadAt: new Date() },
    });
    await prisma.chatThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });

    return NextResponse.json({ message: 'Диалог очищен.' });
  } catch (error) {
    console.error('chat/clear failed', error);
    return NextResponse.json({ error: 'Не удалось очистить диалог.' }, { status: 500 });
  }
}

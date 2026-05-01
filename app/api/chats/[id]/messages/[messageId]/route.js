import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';

export async function DELETE(_request, { params }) {
  try {
    const resolved = await params;
    const threadId = Number(resolved.id);
    const messageId = Number(resolved.messageId);

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

    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
    });

    if (!message || message.threadId !== threadId) {
      return NextResponse.json({ error: 'Сообщение не найдено.' }, { status: 404 });
    }

    if (message.senderId !== session.user.id) {
      return NextResponse.json({ error: 'Можно удалить только свои сообщения.' }, { status: 403 });
    }

    await prisma.chatMessage.delete({ where: { id: messageId } });
    await prisma.chatThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });

    return NextResponse.json({ message: 'Сообщение удалено.' });
  } catch (error) {
    console.error('chat/message delete failed', error);
    return NextResponse.json({ error: 'Не удалось удалить сообщение.' }, { status: 500 });
  }
}

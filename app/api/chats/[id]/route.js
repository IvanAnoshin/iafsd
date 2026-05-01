import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';

export async function DELETE(_request, { params }) {
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

    await prisma.chatParticipant.delete({
      where: {
        threadId_userId: {
          threadId,
          userId: session.user.id,
        },
      },
    });

    const leftParticipants = await prisma.chatParticipant.count({ where: { threadId } });
    if (leftParticipants === 0) {
      await prisma.chatThread.delete({ where: { id: threadId } });
    }

    return NextResponse.json({ message: 'Диалог удалён из списка.' });
  } catch (error) {
    console.error('chat/delete failed', error);
    return NextResponse.json({ error: 'Не удалось удалить диалог.' }, { status: 500 });
  }
}

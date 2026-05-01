import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';

export async function POST() {
  try {
    const session = await getCurrentSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Необходима авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    await prisma.chatParticipant.updateMany({
      where: { userId: session.user.id },
      data: { unreadCount: 0, lastReadAt: new Date() },
    });

    return NextResponse.json({ message: 'Все чаты отмечены прочитанными.' });
  } catch (error) {
    console.error('chat/read-all failed', error);
    return NextResponse.json({ error: 'Не удалось обновить чаты.' }, { status: 500 });
  }
}

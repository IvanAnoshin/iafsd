import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession } from '@/lib/auth';

export async function DELETE(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Не удалось определить сессию.' }, { status: 400 });
    }

    if (id === session.id) {
      return NextResponse.json({ error: 'Текущую сессию заверши через обычный выход.' }, { status: 400 });
    }

    const target = await prisma.session.findFirst({
      where: {
        id,
        userId: session.userId,
      },
    });

    if (!target) {
      return NextResponse.json({ error: 'Сессия не найдена.' }, { status: 404 });
    }

    await prisma.session.delete({ where: { id } });

    return NextResponse.json({ message: 'Сессия завершена.' });
  } catch (error) {
    console.error('auth/sessions/[id] delete failed', error);
    return NextResponse.json({ error: 'Не удалось завершить сессию.' }, { status: 500 });
  }
}

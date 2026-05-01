import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';

export async function POST(request) {
  try {
    const body = await request.json();
    const registrationId = String(body.registration_id || '').trim();
    const secretAnswer = String(body.secret_answer || '').trim();

    if (!registrationId || !secretAnswer) {
      return NextResponse.json({ error: 'Введите секретный ответ.' }, { status: 400 });
    }

    if (secretAnswer.length < 3) {
      return NextResponse.json({ error: 'Секретный ответ слишком короткий.' }, { status: 400 });
    }

    const pending = await prisma.pendingRegistration.findUnique({
      where: { id: registrationId },
    });

    if (!pending) {
      return NextResponse.json({ error: 'Сессия регистрации устарела. Начните заново.' }, { status: 404 });
    }

    const secretAnswerHash = await bcrypt.hash(secretAnswer, 10);

    await prisma.pendingRegistration.update({
      where: { id: registrationId },
      data: { secretAnswerHash },
    });

    return NextResponse.json({ message: 'Секретный ответ сохранён.' });
  } catch (error) {
    console.error('register/secret failed', error);
    return NextResponse.json({ error: 'Не удалось сохранить секретный ответ.' }, { status: 500 });
  }
}

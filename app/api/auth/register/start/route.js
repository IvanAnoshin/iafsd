import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { normalizeName, normalizedKey } from '@/lib/dfsn';
import { enforceRateLimit, getClientIp } from '@/lib/anti-abuse';

export async function POST(request) {
  try {
    const body = await request.json();
    const firstName = normalizeName(body.first_name);
    const lastName = normalizeName(body.last_name);
    const password = String(body.password || '');
    const confirmPassword = String(body.confirm_password || '');

    const registerLimit = await enforceRateLimit({
      request,
      policy: 'auth_register',
      subject: `register:${getClientIp(request)}:${normalizedKey(firstName, lastName) || 'missing'}`,
      metadata: { firstNamePresent: Boolean(firstName), lastNamePresent: Boolean(lastName) },
    });
    if (registerLimit) return registerLimit;

    if (!firstName || !lastName || !password || !confirmPassword) {
      return NextResponse.json({ error: 'Заполните все поля.' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Пароль должен быть не короче 8 символов.' }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'Пароли не совпадают.' }, { status: 400 });
    }

    const key = normalizedKey(firstName, lastName);

    const existingUser = await prisma.user.findUnique({
      where: { normalizedKey: key },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'Такой пользователь уже существует.' }, { status: 409 });
    }

    await prisma.pendingRegistration.deleteMany({
      where: { normalizedKey: key },
    });

    const passwordHash = await bcrypt.hash(password, 10);
    const registrationId = crypto.randomUUID();

    await prisma.pendingRegistration.create({
      data: {
        id: registrationId,
        firstName,
        lastName,
        normalizedKey: key,
        passwordHash,
      },
    });

    return NextResponse.json({
      message: 'Регистрация начата.',
      registration_id: registrationId,
    });
  } catch (error) {
    console.error('register/start failed', error);
    return NextResponse.json({ error: 'Не удалось начать регистрацию.' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { generateBackupCodes } from '@/lib/dfsn';
import { createSessionForUser, applySessionCookie } from '@/lib/auth';

export async function POST(request) {
  try {
    const body = await request.json();
    const registrationId = String(body.registration_id || '').trim();

    if (!registrationId) {
      return NextResponse.json({ error: 'Сессия регистрации не найдена.' }, { status: 400 });
    }

    const pending = await prisma.pendingRegistration.findUnique({
      where: { id: registrationId },
    });

    if (!pending) {
      return NextResponse.json({ error: 'Сессия регистрации устарела. Начните заново.' }, { status: 404 });
    }

    if (!pending.secretAnswerHash) {
      return NextResponse.json({ error: 'Сначала сохраните секретный ответ.' }, { status: 400 });
    }

    if (!pending.dfsnCompleted || !pending.dfsnSessionId || !pending.dfsnProfileSnapshot) {
      return NextResponse.json({ error: 'Сначала завершите DFSN-шаг.' }, { status: 400 });
    }

    const plainBackupCodes = generateBackupCodes(10);
    const backupCodeHashes = await Promise.all(
      plainBackupCodes.map((code) => bcrypt.hash(code, 10))
    );

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          firstName: pending.firstName,
          lastName: pending.lastName,
          normalizedKey: pending.normalizedKey,
          passwordHash: pending.passwordHash,
          secretAnswerHash: pending.secretAnswerHash,
          backupCodeHashes,
          behavioralProfile: pending.dfsnProfileSnapshot,
          behavioralTrustLabel: 'trusted',
          behavioralUpdatedAt: new Date(),
        },
      });

      await tx.dfsnSession.update({
        where: { id: pending.dfsnSessionId },
        data: { userId: created.id, authOutcome: 'registration_complete', trustLabel: 'trusted', labelSource: 'registration_completion', isPassive: false },
      });

      await tx.pendingRegistration.delete({ where: { id: registrationId } });
      return created;
    });

    const { plainToken, session } = await createSessionForUser(user.id, request);
    const response = NextResponse.json({
      message: 'Регистрация завершена.',
      user: {
        id: user.id,
        first_name: user.firstName,
        last_name: user.lastName,
        created_at: user.createdAt,
      },
      backup_codes: plainBackupCodes,
    });
    applySessionCookie(response, plainToken, session.expiresAt);
    return response;
  } catch (error) {
    console.error('register/complete failed', error);
    const text = String(error?.message || '');
    if (text.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Такой пользователь уже существует.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Не удалось завершить регистрацию.' }, { status: 500 });
  }
}

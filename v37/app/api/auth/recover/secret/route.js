import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { createSessionForUser, applySessionCookie, ensureCsrfCookie } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { normalizeName, normalizedKey } from '@/lib/dfsn';

export async function POST(request) {
  try {
    const body = await request.json();
    const firstName = normalizeName(body.first_name);
    const lastName = normalizeName(body.last_name);
    const secretAnswer = String(body.secret_answer || '').trim();

    if (!firstName || !lastName || !secretAnswer) {
      await writeAuditLog({ request, action: 'auth.recover.secret', status: 'failed', metadata: { reason: 'missing_fields', firstName, lastName } });
      return NextResponse.json({ error: 'Введите имя, фамилию и секретный ответ.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { normalizedKey: normalizedKey(firstName, lastName) },
    });

    if (!user) {
      await writeAuditLog({ request, action: 'auth.recover.secret', status: 'failed', metadata: { reason: 'user_not_found', normalizedKey: normalizedKey(firstName, lastName) } });
      return NextResponse.json({ error: 'Пользователь не найден.' }, { status: 404 });
    }

    const ok = await bcrypt.compare(secretAnswer, user.secretAnswerHash);
    if (!ok) {
      await writeAuditLog({ request, actorUserId: user.id, action: 'auth.recover.secret', status: 'failed', metadata: { reason: 'invalid_secret_answer' } });
      return NextResponse.json({ error: 'Секретный ответ не подошёл.' }, { status: 401 });
    }

    const { plainToken, session } = await createSessionForUser(user.id, request);
    const response = NextResponse.json({
      message: 'Доступ восстановлен.',
      user: { id: user.id, first_name: user.firstName, last_name: user.lastName, created_at: user.createdAt },
    });
    applySessionCookie(response, plainToken, session.expiresAt);
    ensureCsrfCookie(response, request);
    await writeAuditLog({ request, session, action: 'auth.recover.secret', entityType: 'session', entityId: session.id });
    return response;
  } catch (error) {
    console.error('recover/secret failed', error);
    await writeAuditLog({ request, action: 'auth.recover.secret', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось восстановить доступ.' }, { status: 500 });
  }
}

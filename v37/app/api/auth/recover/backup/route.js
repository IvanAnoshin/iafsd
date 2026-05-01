import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { formatRecoveryCode, normalizeName, normalizedKey } from '@/lib/dfsn';
import { createSessionForUser, applySessionCookie, ensureCsrfCookie } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request) {
  try {
    const body = await request.json();
    const firstName = normalizeName(body.first_name);
    const lastName = normalizeName(body.last_name);
    const backupCode = formatRecoveryCode(body.backup_code);

    if (!firstName || !lastName || !backupCode) {
      await writeAuditLog({ request, action: 'auth.recover.backup', status: 'failed', metadata: { reason: 'missing_fields', firstName, lastName } });
      return NextResponse.json({ error: 'Введите имя, фамилию и резервный код.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { normalizedKey: normalizedKey(firstName, lastName) },
    });

    if (!user) {
      await writeAuditLog({ request, action: 'auth.recover.backup', status: 'failed', metadata: { reason: 'user_not_found', normalizedKey: normalizedKey(firstName, lastName) } });
      return NextResponse.json({ error: 'Пользователь не найден.' }, { status: 404 });
    }

    const storedHashes = Array.isArray(user.backupCodeHashes) ? user.backupCodeHashes : [];

    let matchedIndex = -1;
    for (let i = 0; i < storedHashes.length; i += 1) {
      const ok = await bcrypt.compare(backupCode, String(storedHashes[i]));
      if (ok) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex === -1) {
      await writeAuditLog({ request, actorUserId: user.id, action: 'auth.recover.backup', status: 'failed', metadata: { reason: 'invalid_backup_code' } });
      return NextResponse.json({ error: 'Этот резервный код не подошёл.' }, { status: 401 });
    }

    const nextHashes = storedHashes.filter((_, index) => index !== matchedIndex);

    await prisma.user.update({
      where: { id: user.id },
      data: { backupCodeHashes: nextHashes },
    });

    const { plainToken, session } = await createSessionForUser(user.id, request);
    const response = NextResponse.json({
      message: 'Доступ восстановлен.',
      user: {
        id: user.id,
        first_name: user.firstName,
        last_name: user.lastName,
        created_at: user.createdAt,
      },
    });
    applySessionCookie(response, plainToken, session.expiresAt);
    ensureCsrfCookie(response, request);
    await writeAuditLog({ request, session, action: 'auth.recover.backup', entityType: 'session', entityId: session.id, metadata: { remainingBackupCodes: nextHashes.length } });
    return response;
  } catch (error) {
    console.error('recover/backup failed', error);
    await writeAuditLog({ request, action: 'auth.recover.backup', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось восстановить доступ.' }, { status: 500 });
  }
}

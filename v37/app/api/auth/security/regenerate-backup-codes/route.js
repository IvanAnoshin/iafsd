import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { getCurrentSession, verifyCsrf } from '@/lib/auth';
import { generateBackupCodes } from '@/lib/dfsn';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    const session = await getCurrentSession();
    if (!session) {
      await writeAuditLog({ request, action: 'auth.security.regenerate_backup_codes', status: 'failed', metadata: { reason: 'missing_session' } });
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    const body = await request.json();
    const password = String(body.password || '').trim();
    if (!password) {
      await writeAuditLog({ request, session, action: 'auth.security.regenerate_backup_codes', status: 'failed', metadata: { reason: 'missing_password' } });
      return NextResponse.json({ error: 'Введите пароль.' }, { status: 400 });
    }

    const passwordOk = await bcrypt.compare(password, session.user.passwordHash);
    if (!passwordOk) {
      await writeAuditLog({ request, session, action: 'auth.security.regenerate_backup_codes', status: 'failed', metadata: { reason: 'bad_password' } });
      return NextResponse.json({ error: 'Неверный пароль.' }, { status: 401 });
    }

    const plainCodes = generateBackupCodes(10);
    const backupCodeHashes = await Promise.all(plainCodes.map((code) => bcrypt.hash(code, 10)));

    await prisma.user.update({
      where: { id: session.user.id },
      data: { backupCodeHashes },
    });

    await writeAuditLog({ request, session, action: 'auth.security.regenerate_backup_codes', entityType: 'user', entityId: session.user.id, metadata: { count: plainCodes.length } });

    return NextResponse.json({
      message: 'Резервные коды перевыпущены.',
      backup_codes: plainCodes,
    });
  } catch (error) {
    console.error('security/regenerate-backup-codes failed', error);
    await writeAuditLog({ request, action: 'auth.security.regenerate_backup_codes', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось перевыпустить резервные коды.' }, { status: 500 });
  }
}

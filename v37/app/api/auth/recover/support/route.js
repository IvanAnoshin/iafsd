import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { normalizeName, normalizedKey } from '@/lib/dfsn';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request) {
  try {
    const body = await request.json();
    const firstName = normalizeName(body.first_name);
    const lastName = normalizeName(body.last_name);
    const message = String(body.message || '').trim() || 'Запрос на восстановление доступа';

    if (!firstName || !lastName) {
      await writeAuditLog({ request, action: 'auth.recover.support', status: 'failed', metadata: { reason: 'missing_name', firstName, lastName } });
      return NextResponse.json({ error: 'Введите имя и фамилию.' }, { status: 400 });
    }

    const supportRequest = await prisma.supportRequest.create({
      data: {
        firstName,
        lastName,
        normalizedKey: normalizedKey(firstName, lastName),
        message,
      },
    });

    await writeAuditLog({ request, action: 'auth.recover.support', entityType: 'support_request', entityId: supportRequest.id, metadata: { normalizedKey: supportRequest.normalizedKey } });

    return NextResponse.json({ message: 'Запрос в поддержку отправлен.' });
  } catch (error) {
    console.error('recover/support failed', error);
    await writeAuditLog({ request, action: 'auth.recover.support', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось отправить запрос.' }, { status: 500 });
  }
}

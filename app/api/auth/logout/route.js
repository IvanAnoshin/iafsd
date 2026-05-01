import { NextResponse } from 'next/server';
import { clearSessionCookie, clearCsrfCookie, getCurrentSession, verifyCsrf } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    const session = await getCurrentSession();
    if (session) {
      await writeAuditLog({ request, session, action: 'auth.logout', entityType: 'session', entityId: session.id });
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    }

    const response = NextResponse.json({ message: 'Сессия завершена.' });
    clearSessionCookie(response);
    clearCsrfCookie(response);
    return response;
  } catch (error) {
    console.error('auth/logout failed', error);
    await writeAuditLog({ request, action: 'auth.logout', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    const response = NextResponse.json({ error: 'Не удалось завершить сессию.' }, { status: 500 });
    clearSessionCookie(response);
    clearCsrfCookie(response);
    return response;
  }
}

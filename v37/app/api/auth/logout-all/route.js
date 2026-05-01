import { NextResponse } from 'next/server';
import { clearSessionCookie, clearCsrfCookie, getCurrentSession, verifyCsrf } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    const session = await getCurrentSession();
    if (!session) {
      const response = NextResponse.json({ error: 'Сессия не найдена.' }, { status: 401 });
      clearSessionCookie(response);
      clearCsrfCookie(response);
      return response;
    }

    const deleted = await prisma.session.deleteMany({ where: { userId: session.userId } });

    await writeAuditLog({ request, session, action: 'auth.logout_all', entityType: 'user', entityId: session.userId, metadata: { deletedSessions: deleted.count } });

    const response = NextResponse.json({ message: 'Все сессии завершены.' });
    clearSessionCookie(response);
    clearCsrfCookie(response);
    return response;
  } catch (error) {
    console.error('auth/logout-all failed', error);
    await writeAuditLog({ request, action: 'auth.logout_all', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    const response = NextResponse.json({ error: 'Не удалось завершить все сессии.' }, { status: 500 });
    clearSessionCookie(response);
    clearCsrfCookie(response);
    return response;
  }
}

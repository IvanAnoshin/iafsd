import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { recordBehaviorUpdate } from '@/lib/behavior';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request) {
  let auditSession = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    auditSession = session;
    if (!session) {
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    await touchSession(session.id);

    const body = await request.json();
    const result = await recordBehaviorUpdate({
      user: session.user,
      request,
      payload: body,
    });

    await writeAuditLog({
      request,
      session,
      action: 'behavior.update',
      entityType: 'dfsn_session',
      entityId: result.sessionId,
      metadata: {
        route: body?.route || null,
        screen: body?.screen || null,
        qualityFlags: result.qualityFlags,
      },
    });

    return NextResponse.json({
      message: 'Поведенческий профиль обновлён.',
      dfsn_session_id: result.sessionId,
      trust_label: result.trustLabel,
      quality_flags: result.qualityFlags,
      summary: result.summary,
    });
  } catch (error) {
    console.error('behavior/update failed', error);
    await writeAuditLog({
      request,
      session: auditSession,
      action: 'behavior.update',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    const status = Number(error?.status) || 500;
    return NextResponse.json({ error: error?.message || 'Не удалось обновить поведенческий профиль.' }, { status });
  }
}

import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { recordBehaviorBatch } from '@/lib/behavior';
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
    const result = await recordBehaviorBatch({
      user: session.user,
      request,
      items: body.items || body.events,
    });

    await writeAuditLog({
      request,
      session,
      action: 'behavior.batch',
      entityType: 'dfsn_session',
      entityId: result.sessionIds[0] || null,
      metadata: {
        createdCount: result.createdCount,
        qualityFlags: result.qualityFlags,
      },
    });

    return NextResponse.json({
      message: 'Пакет поведенческих событий сохранён.',
      created_count: result.createdCount,
      dfsn_session_ids: result.sessionIds,
      trust_label: result.trustLabel,
      quality_flags: result.qualityFlags,
    });
  } catch (error) {
    console.error('behavior/batch failed', error);
    await writeAuditLog({
      request,
      session: auditSession,
      action: 'behavior.batch',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    const status = Number(error?.status) || 500;
    return NextResponse.json({ error: error?.message || 'Не удалось сохранить пакет поведенческих событий.' }, { status });
  }
}

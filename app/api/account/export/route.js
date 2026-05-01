import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { buildUserDataExport, createDataExportRecord } from '@/lib/account-data';
import { requirePasswordConfirmation, sensitiveJson } from '@/lib/sensitive-actions';
import { enforceRateLimit } from '@/lib/anti-abuse';

export async function POST(request) {
  const csrf = verifyCsrf(request);
  if (!csrf.ok) return csrf.response;

  const session = await getCurrentSession();
  if (!session) return sensitiveJson({ error: 'Требуется авторизация.' }, { status: 401 });

  try {
    await touchSession(session.id);
    const limit = await enforceRateLimit({ request, policy: 'account_data_export', actorUserId: session.user.id });
    if (limit) return limit;

    const body = await request.json().catch(() => ({}));
    const passwordError = await requirePasswordConfirmation({
      request,
      session,
      password: body.password,
      action: 'account.export.confirm_password',
    });
    if (passwordError) return passwordError;

    const exportPayload = await buildUserDataExport(session.user.id);
    const record = await createDataExportRecord(session.user.id, exportPayload);

    await writeAuditLog({
      request,
      session,
      action: 'account.data_export.create',
      entityType: 'user_data_export',
      entityId: record.id,
      metadata: { counts: exportPayload.counts },
    });

    return sensitiveJson({
      message: 'Экспорт подготовлен.',
      export_id: record.id,
      generated_at: exportPayload.generated_at,
      expires_at: record.expiresAt,
      data: exportPayload,
    }, {
      headers: {
        'Content-Disposition': `attachment; filename="friendscape-export-${session.user.id}.json"`,
      },
    });
  } catch (error) {
    console.error('account export failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'account.data_export.create',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return sensitiveJson({ error: error?.message || 'Не удалось подготовить экспорт.' }, { status: error?.status || 500 });
  }
}

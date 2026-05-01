import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import {
  cancelAccountDeletion,
  getAccountDeletionStatus,
  requestAccountDeletion,
  setAccountDeactivation,
  serializeDeletionRequest,
} from '@/lib/account-data';
import { requirePasswordConfirmation, sensitiveJson } from '@/lib/sensitive-actions';
import { enforceRateLimit } from '@/lib/anti-abuse';

function buildAccountDeletionFallbackStatus(user) {
  return {
    account_status: user?.accountStatus || 'active',
    deactivated_at: user?.deactivatedAt ? new Date(user.deactivatedAt).toISOString() : null,
    deletion_requested_at: user?.deletionRequestedAt ? new Date(user.deletionRequestedAt).toISOString() : null,
    deletion_scheduled_at: user?.deletionScheduledAt ? new Date(user.deletionScheduledAt).toISOString() : null,
    deleted_at: user?.deletedAt ? new Date(user.deletedAt).toISOString() : null,
    deletion_request: null,
    grace_days: 14,
    degraded: true,
  };
}

export async function GET() {
  let session = null;

  try {
    session = await getCurrentSession();
    if (!session) return sensitiveJson({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const status = await getAccountDeletionStatus(session.user.id);
    return sensitiveJson({ status });
  } catch (error) {
    console.warn('account deletion status fallback enabled', error?.message || error);
    if (!session?.user) return sensitiveJson({ error: 'Не удалось загрузить статус аккаунта.' }, { status: 500 });
    return sensitiveJson({ status: buildAccountDeletionFallbackStatus(session.user) });
  }
}

export async function POST(request) {
  const csrf = verifyCsrf(request);
  if (!csrf.ok) return csrf.response;

  const session = await getCurrentSession();
  if (!session) return sensitiveJson({ error: 'Требуется авторизация.' }, { status: 401 });

  try {
    await touchSession(session.id);
    const limit = await enforceRateLimit({ request, policy: 'account_deletion_action', actorUserId: session.user.id });
    if (limit) return limit;

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();
    const allowed = new Set(['request', 'cancel', 'deactivate', 'reactivate']);
    if (!allowed.has(action)) {
      return sensitiveJson({ error: 'Неизвестное действие.' }, { status: 400 });
    }

    const passwordError = await requirePasswordConfirmation({
      request,
      session,
      password: body.password,
      action: `account.deletion.${action}.confirm_password`,
    });
    if (passwordError) return passwordError;

    if (action === 'request') {
      const deletionRequest = await requestAccountDeletion(session.user.id, { reason: body.reason });
      await writeAuditLog({
        request,
        session,
        action: 'account.deletion.request',
        entityType: 'account_deletion_request',
        entityId: deletionRequest.id,
      });
      return sensitiveJson({
        message: 'Удаление аккаунта запланировано. Его можно отменить до даты удаления.',
        deletion_request: serializeDeletionRequest(deletionRequest),
        status: await getAccountDeletionStatus(session.user.id),
      }, { status: 201 });
    }

    if (action === 'cancel') {
      const deletionRequest = await cancelAccountDeletion(session.user.id);
      await writeAuditLog({
        request,
        session,
        action: 'account.deletion.cancel',
        entityType: 'account_deletion_request',
        entityId: deletionRequest?.id || null,
      });
      return sensitiveJson({
        message: deletionRequest ? 'Удаление аккаунта отменено.' : 'Активного запроса на удаление не было.',
        deletion_request: serializeDeletionRequest(deletionRequest),
        status: await getAccountDeletionStatus(session.user.id),
      });
    }

    if (action === 'deactivate') {
      await setAccountDeactivation(session.user.id, true);
      await writeAuditLog({ request, session, action: 'account.deactivate', entityType: 'user', entityId: session.user.id });
      return sensitiveJson({ message: 'Аккаунт деактивирован.', status: await getAccountDeletionStatus(session.user.id) });
    }

    await setAccountDeactivation(session.user.id, false);
    await writeAuditLog({ request, session, action: 'account.reactivate', entityType: 'user', entityId: session.user.id });
    return sensitiveJson({ message: 'Аккаунт снова активен.', status: await getAccountDeletionStatus(session.user.id) });
  } catch (error) {
    console.error('account deletion action failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'account.deletion.action',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return sensitiveJson({ error: error?.message || 'Не удалось выполнить действие.' }, { status: error?.status || 500 });
  }
}

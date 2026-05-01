import { NextResponse } from 'next/server';
import { getCurrentSession, isAdminUser, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/anti-abuse';

function noStoreHeaders(extra = {}) {
  return { 'Cache-Control': 'no-store', ...extra };
}

export function adminJson(data, init = {}) {
  return NextResponse.json(data, {
    ...init,
    headers: noStoreHeaders(init.headers || {}),
  });
}

export function adminCsv(body, init = {}) {
  return new NextResponse(body, {
    ...init,
    headers: noStoreHeaders(init.headers || {}),
  });
}

export async function requireAdminRequest(request, { action = 'admin.request', write = false, exportAction = false } = {}) {
  const session = await getCurrentSession();
  if (!session) {
    await writeAuditLog({ request, action, status: 'unauthenticated' }).catch(() => null);
    return { response: adminJson({ error: 'Требуется вход в аккаунт.', code: 'UNAUTHENTICATED' }, { status: 401 }), session: null };
  }

  if (!isAdminUser(session.user)) {
    await writeAuditLog({ request, session, action, status: 'forbidden' }).catch(() => null);
    return { response: adminJson({ error: 'Недостаточно прав.', code: 'FORBIDDEN' }, { status: 403 }), session };
  }

  if (write) {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) {
      await writeAuditLog({ request, session, action, status: 'blocked', metadata: { reason: 'csrf_failed' } }).catch(() => null);
      return { response: csrf.response, session };
    }
  }

  const rateLimit = await enforceRateLimit({
    request,
    policy: exportAction ? 'admin_export' : write ? 'admin_write' : 'admin_read',
    actorUserId: session.user.id,
    subject: `admin:${session.user.id}:${action}`,
    metadata: { action, write, exportAction },
  });
  if (rateLimit) {
    await writeAuditLog({ request, session, action, status: 'rate_limited' }).catch(() => null);
    return { response: rateLimit, session };
  }

  return { session, response: null };
}

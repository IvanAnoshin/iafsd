import { NextResponse } from 'next/server';
import { requireAdminSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { applyGlobalModerationAction } from '@/lib/admin-moderation';

export async function POST(request) {
  let session = null;
  let body = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await requireAdminSession();
    if (!session) return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });

    body = await request.json().catch(() => ({}));
    const result = await applyGlobalModerationAction(session.user.id, body || {});

    await writeAuditLog({
      request,
      session,
      action: `admin.moderation.${body?.action || 'action'}`,
      entityType: body?.entity_type || body?.entityType || null,
      entityId: body?.entity_id || body?.entityId || null,
      metadata: { reason: body?.reason || null, status: body?.status || body?.global_status || null },
    });

    return NextResponse.json({ ok: true, result, message: 'Действие модерации выполнено.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('admin/moderation/action failed', error);
    await writeAuditLog({
      request,
      session,
      action: `admin.moderation.${body?.action || 'action'}`,
      entityType: body?.entity_type || body?.entityType || null,
      entityId: body?.entity_id || body?.entityId || null,
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: error?.message || 'Не удалось выполнить действие модерации.' }, { status: error?.status || 500 });
  }
}

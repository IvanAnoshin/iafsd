import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { listGlobalModerationQueue } from '@/lib/admin-moderation';

export async function GET(request) {
  let session = null;
  try {
    session = await requireAdminSession();
    if (!session) return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const payload = await listGlobalModerationQueue({
      status: searchParams.get('status') || 'pending',
      type: searchParams.get('type') || 'all',
      limit: searchParams.get('limit') || 30,
      offset: searchParams.get('offset') || 0,
    });

    await writeAuditLog({
      request,
      session,
      action: 'admin.moderation.queue.list',
      metadata: { status: payload.status, type: payload.type, limit: payload.limit, offset: payload.offset, count: payload.items.length },
    });

    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('admin/moderation/queue failed', error);
    await writeAuditLog({ request, session, action: 'admin.moderation.queue.list', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: error?.message || 'Не удалось загрузить очередь модерации.' }, { status: error?.status || 500 });
  }
}

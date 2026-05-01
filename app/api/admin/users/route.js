import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { listAdminUsers } from '@/lib/admin';

export async function GET(request) {
  let session = null;
  try {
    session = await requireAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const payload = await listAdminUsers({
      q: searchParams.get('q') || '',
      trustLabel: searchParams.get('trust_label') || '',
      sort: searchParams.get('sort') || 'recent',
      limit: searchParams.get('limit') || 20,
      offset: searchParams.get('offset') || 0,
    });

    await writeAuditLog({
      request,
      session,
      action: 'admin.users.list',
      metadata: {
        q: searchParams.get('q') || '',
        trust_label: searchParams.get('trust_label') || '',
        sort: searchParams.get('sort') || 'recent',
        limit: payload.limit,
        offset: payload.offset,
      },
    });

    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('admin/users failed', error);
    await writeAuditLog({ request, session, action: 'admin.users.list', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось загрузить список пользователей.' }, { status: 500 });
  }
}

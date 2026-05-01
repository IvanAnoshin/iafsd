import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createSupportTicket, listSupportTickets } from '@/lib/support';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    await touchSession(session.id);
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') || 20);
    const result = await listSupportTickets(session.user.id, { limit });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('support/tickets get failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось загрузить обращения.' }, { status: error?.status || 500 });
  }
}

export async function POST(request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

  try {
    await touchSession(session.id);
    const body = await request.json().catch(() => ({}));
    const ticket = await createSupportTicket(session.user.id, body);
    await writeAuditLog({
      request,
      session,
      action: 'support.ticket.create',
      entityType: 'support_ticket',
      entityId: ticket.id,
      metadata: { category: ticket.category },
    });
    return NextResponse.json({ ticket, message: 'Обращение отправлено в поддержку.' }, { status: 201 });
  } catch (error) {
    console.error('support/tickets post failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'support.ticket.create',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: error?.message || 'Не удалось отправить обращение.' }, { status: error?.status || 500 });
  }
}

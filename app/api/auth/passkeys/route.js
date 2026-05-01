import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serializePasskey } from '@/lib/passkeys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let session = null;

  try {
    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    await touchSession(session.id);
    const items = await prisma.accountPasskey.findMany({
      where: { userId: session.user.id, disabledAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ items: items.map(serializePasskey) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.warn('passkeys list fallback enabled', error?.message || error);
    if (!session?.user) return NextResponse.json({ error: 'Не удалось получить passkeys.' }, { status: 500 });
    return NextResponse.json({ items: [], degraded: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
}

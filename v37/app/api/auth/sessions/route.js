import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    await touchSession(session.id);

    const sessions = await prisma.session.findMany({
      where: { userId: session.userId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      sessions: sessions.map((item) => ({
        id: item.id,
        label: item.label,
        ip_address: item.ipAddress,
        created_at: item.createdAt,
        last_seen_at: item.lastSeenAt,
        expires_at: item.expiresAt,
        is_current: item.id === session.id,
      })),
    });
  } catch (error) {
    console.error('auth/sessions failed', error);
    return NextResponse.json({ error: 'Не удалось получить список сессий.' }, { status: 500 });
  }
}

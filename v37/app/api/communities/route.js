import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serializeCommunity } from '@/lib/communities';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(Number(searchParams.get('limit') || 24) || 24, 60));
    const communities = await prisma.community.findMany({
      where: { visibility: 'public' },
      orderBy: [{ isOfficial: 'desc' }, { lastActivityAt: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    }).catch(() => []);

    const memberships = communities.length
      ? await prisma.communityMember.findMany({
          where: { userId: session.user.id, communityId: { in: communities.map((item) => item.id) } },
          select: { communityId: true, role: true },
        }).catch(() => [])
      : [];
    const membershipMap = new Map(memberships.map((item) => [item.communityId, item]));

    return NextResponse.json({ communities: communities.map((community) => serializeCommunity(community, membershipMap)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/list failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить список сообществ.' }, { status: 500 });
  }
}

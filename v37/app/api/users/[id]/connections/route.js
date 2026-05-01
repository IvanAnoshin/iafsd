import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession } from '@/lib/auth';

function initialsOf(firstName, lastName) {
  return `${String(firstName || '').trim().charAt(0)}${String(lastName || '').trim().charAt(0)}`.toUpperCase();
}

function mapPerson(item, extra = {}) {
  const profile = item.publicProfile;
  return {
    id: item.id,
    name: `${item.firstName} ${item.lastName}`.trim(),
    handle: profile ? `@${profile.handle}` : '@user',
    occupation: profile?.occupation || 'Участник Friendscape',
    city: profile?.city || 'Friendscape',
    tone: profile?.tone || 'violet',
    status: profile?.status || 'recent',
    initials: initialsOf(item.firstName, item.lastName),
    ...extra,
  };
}

function buildTitle(kind) {
  if (kind === 'followers') return 'Подписчики';
  if (kind === 'following') return 'Подписки';
  return 'Друзья';
}

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    const userId = Number((await params).id);
    const { searchParams } = new URL(request.url);
    const kind = String(searchParams.get('kind') || 'friends');

    if (!userId) return NextResponse.json({ error: 'Некорректный пользователь.' }, { status: 400 });

    let rows = [];

    if (kind === 'followers') {
      const subscriptions = await prisma.subscription.findMany({
        where: { toUserId: userId },
        include: {
          fromUser: { include: { publicProfile: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      rows = subscriptions.map((item) => mapPerson(item.fromUser, { subscribedAt: item.createdAt }));
    } else if (kind === 'following') {
      const subscriptions = await prisma.subscription.findMany({
        where: { fromUserId: userId },
        include: {
          toUser: { include: { publicProfile: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      rows = subscriptions.map((item) => mapPerson(item.toUser, { subscribedAt: item.createdAt }));
    } else {
      const friendships = await prisma.friendship.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        include: {
          userA: { include: { publicProfile: true } },
          userB: { include: { publicProfile: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      rows = friendships.map((item) => {
        const friend = item.userAId === userId ? item.userB : item.userA;
        return mapPerson(friend, { friendedAt: item.createdAt });
      });
    }

    return NextResponse.json({
      title: buildTitle(kind),
      kind,
      items: rows,
      count: rows.length,
      selfUserId: session.user.id,
    });
  } catch (error) {
    console.error('users/connections failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить список.' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, verifyCsrf } from '@/lib/auth';
import { acceptFriendRequest, cancelFriendRequest, followUser, removeFriend, sendFriendRequest, unfollowUser } from '@/lib/social';

function buildMeta(profile) {
  const left = profile.occupation || 'Участник';
  const right = profile.city || 'Friendscape';
  return `${left} · ${right}`;
}

function buildMutualText(value) {
  const count = Number(value || 0);
  if (!count) return 'Пока без общих знакомых';
  return `${count} общих знакомых`;
}

function buildReason(person) {
  if (person.relation === 'incoming_request') return 'Отправил вам заявку';
  if (person.relation === 'friends') return 'Уже в вашем круге';
  if (person.followsYou && person.mutualCount >= 3) return `${person.mutualCount} общих знакомых и подписан на вас`;
  if (person.followsYou) return 'Подписан на вас';
  if (person.mutualCount >= 8) return `${person.mutualCount} общих знакомых`;
  if (person.status === 'online') return 'Сейчас онлайн';
  if (person.followersCount >= 12) return `${person.followersCount} подписчиков`;
  return person.meta;
}

function buildPeopleFallbackPayload(sort = 'relevant') {
  return {
    people: [],
    requests: [],
    summary: { total: 0, online: 0, mutual: 0, followsYou: 0, requests: 0, sort },
    degraded: true,
  };
}

function buildPriorityScore(person) {
  let score = 0;
  if (person.relation === 'incoming_request') score += 120;
  if (person.relation === 'friends') score += 55;
  if (person.status === 'online') score += 28;
  if (person.followsYou) score += 20;
  if (person.isFollowing) score += 10;
  score += Math.min(person.mutualCount * 4, 48);
  score += Math.min(person.followersCount, 25);
  return score;
}

function sortPeople(list, sort) {
  const items = [...list];
  if (sort === 'online') {
    return items.sort((a, b) => {
      const onlineDiff = Number(b.status === 'online') - Number(a.status === 'online');
      if (onlineDiff) return onlineDiff;
      return b.priorityScore - a.priorityScore || a.name.localeCompare(b.name, 'ru');
    });
  }
  if (sort === 'mutual') {
    return items.sort((a, b) => b.mutualCount - a.mutualCount || b.priorityScore - a.priorityScore || a.name.localeCompare(b.name, 'ru'));
  }
  if (sort === 'followers') {
    return items.sort((a, b) => b.followersCount - a.followersCount || b.priorityScore - a.priorityScore || a.name.localeCompare(b.name, 'ru'));
  }
  return items.sort((a, b) => b.priorityScore - a.priorityScore || a.name.localeCompare(b.name, 'ru'));
}

function initialsOf(firstName, lastName) {
  return `${String(firstName || '').trim().charAt(0)}${String(lastName || '').trim().charAt(0)}`.toUpperCase();
}

async function ensureProfileForUser(user) {
  const existing = await prisma.userPublicProfile.findUnique({ where: { userId: user.id } });
  if (existing) return existing;

  const baseHandle = `${user.firstName}.${user.lastName}`.toLowerCase();
  let handle = baseHandle;
  let suffix = 1;
  while (await prisma.userPublicProfile.findUnique({ where: { handle } })) {
    handle = `${baseHandle}${suffix}`;
    suffix += 1;
  }

  return prisma.userPublicProfile.create({
    data: {
      userId: user.id,
      handle,
      occupation: 'Участник Friendscape',
      city: 'Вильнюс',
      tone: 'violet',
      status: 'online',
      mutualHint: 0,
    },
  });
}

function computeMutualCount(currentFriendIds, candidateId, friendships, hint) {
  const candidateFriends = new Set();
  for (const item of friendships) {
    if (item.userAId === candidateId) candidateFriends.add(item.userBId);
    if (item.userBId === candidateId) candidateFriends.add(item.userAId);
  }
  let count = 0;
  currentFriendIds.forEach((friendId) => {
    if (candidateFriends.has(friendId)) count += 1;
  });
  return Math.max(count, Number(hint || 0));
}

async function buildPeoplePayload(currentUser, query, filter, sort = 'relevant') {
  await ensureProfileForUser(currentUser);

  const profiles = await prisma.userPublicProfile.findMany({
    include: { user: true },
    orderBy: [{ status: 'asc' }, { handle: 'asc' }],
  });

  const [friendships, allFriendships, incomingRequests, outgoingRequests, subscriptionsOut, subscriptionsIn] = await prisma.$transaction([
    prisma.friendship.findMany({
      where: { OR: [{ userAId: currentUser.id }, { userBId: currentUser.id }] },
    }),
    prisma.friendship.findMany({
      where: {
        OR: [
          { userAId: currentUser.id },
          { userBId: currentUser.id },
          { userAId: { in: profiles.map((item) => item.userId) } },
          { userBId: { in: profiles.map((item) => item.userId) } },
        ],
      },
    }),
    prisma.friendRequest.findMany({
      where: { toUserId: currentUser.id, status: 'pending' },
      include: {
        fromUser: { include: { publicProfile: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.friendRequest.findMany({
      where: { fromUserId: currentUser.id, status: 'pending' },
      select: { toUserId: true },
    }),
    prisma.subscription.findMany({
      where: { fromUserId: currentUser.id },
      select: { toUserId: true },
    }),
    prisma.subscription.findMany({
      where: { toUserId: currentUser.id },
      select: { fromUserId: true },
    }),
  ]);

  const followerCounts = await prisma.subscription.groupBy({ by: ['toUserId'], _count: { _all: true } });
  const friendCounts = new Map();
  allFriendships.forEach((item) => {
    friendCounts.set(item.userAId, (friendCounts.get(item.userAId) || 0) + 1);
    friendCounts.set(item.userBId, (friendCounts.get(item.userBId) || 0) + 1);
  });
  const followerMap = new Map(followerCounts.map((item) => [item.toUserId, item._count._all]));

  const currentFriendIds = new Set(friendships.map((item) => (item.userAId === currentUser.id ? item.userBId : item.userAId)));
  const outgoingIds = new Set(outgoingRequests.map((item) => item.toUserId));
  const incomingIds = new Set(incomingRequests.map((item) => item.fromUserId));
  const subscriptionOutIds = new Set(subscriptionsOut.map((item) => item.toUserId));
  const subscriptionInIds = new Set(subscriptionsIn.map((item) => item.fromUserId));

  const normalizedQuery = String(query || '').trim().toLowerCase();

  const people = sortPeople(
    profiles
      .filter((profile) => profile.userId !== currentUser.id)
      .map((profile) => {
        const relation = currentFriendIds.has(profile.userId)
          ? 'friends'
          : incomingIds.has(profile.userId)
            ? 'incoming_request'
            : outgoingIds.has(profile.userId)
              ? 'outgoing_request'
              : 'none';

        const mutualCount = computeMutualCount(currentFriendIds, profile.userId, allFriendships, profile.mutualHint);
        const person = {
          id: profile.userId,
          name: `${profile.user.firstName} ${profile.user.lastName}`.trim(),
          handle: `@${profile.handle}`,
          occupation: profile.occupation || 'Участник Friendscape',
          city: profile.city || 'Friendscape',
          meta: buildMeta(profile),
          mutualCount,
          mutual: buildMutualText(mutualCount),
          tone: profile.tone,
          initials: initialsOf(profile.user.firstName, profile.user.lastName),
          status: profile.status,
          relation,
          isFollowing: subscriptionOutIds.has(profile.userId),
          followsYou: subscriptionInIds.has(profile.userId),
          followersCount: followerMap.get(profile.userId) || 0,
          friendsCount: friendCounts.get(profile.userId) || 0,
        };

        return {
          ...person,
          why: buildReason(person),
          priorityScore: buildPriorityScore(person),
        };
      })
      .filter((person) => {
        if (filter === 'online' && person.status !== 'online') return false;
        if (filter === 'mutual' && person.mutualCount < 3) return false;
        if (!normalizedQuery) return true;
        return [person.name, person.handle, person.meta, person.mutual, person.why, person.occupation, person.city]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      }),
    sort
  );

  const requests = incomingRequests.map((item) => ({
    id: item.fromUser.id,
    requestId: item.id,
    name: `${item.fromUser.firstName} ${item.fromUser.lastName}`.trim(),
    handle: `@${item.fromUser.publicProfile?.handle || `${item.fromUser.firstName}.${item.fromUser.lastName}`.toLowerCase()}`,
    note: 'Хочет добавить вас в друзья',
    mutualCount: Number(item.fromUser.publicProfile?.mutualHint || 0),
    mutual: buildMutualText(item.fromUser.publicProfile?.mutualHint || 0),
    tone: item.fromUser.publicProfile?.tone || 'violet',
    initials: initialsOf(item.fromUser.firstName, item.fromUser.lastName),
  }));

  const summary = {
    total: people.length,
    online: people.filter((person) => person.status === 'online').length,
    mutual: people.filter((person) => person.mutualCount >= 3).length,
    followsYou: people.filter((person) => person.followsYou).length,
    requests: requests.length,
    sort,
  };

  return { people, requests, summary };
}

export async function GET(request) {
  let session = null;

  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') || '';
    const filter = searchParams.get('filter') || 'all';
    const sort = searchParams.get('sort') || 'relevant';

    const payload = await buildPeoplePayload(session.user, query, filter, sort);
    return NextResponse.json(payload);
  } catch (error) {
    console.warn('people/get fallback enabled', error?.message || error);
    if (!session?.user) {
      return NextResponse.json({ error: 'Не удалось загрузить список людей.' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    return NextResponse.json(buildPeopleFallbackPayload(searchParams.get('sort') || 'relevant'), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    const body = await request.json();
    const targetUserId = Number(body.target_user_id);
    const action = String(body.action || '');

    if (!targetUserId || targetUserId === session.user.id) {
      return NextResponse.json({ error: 'Некорректный пользователь.' }, { status: 400 });
    }

    if (!['send_request', 'cancel_request', 'accept_request', 'remove_friend', 'follow', 'unfollow'].includes(action)) {
      return NextResponse.json({ error: 'Некорректное действие.' }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) {
      return NextResponse.json({ error: 'Пользователь не найден.' }, { status: 404 });
    }

    if (action === 'follow') {
      const result = await followUser(session.user.id, targetUserId);
      return NextResponse.json(result);
    }

    if (action === 'unfollow') {
      const result = await unfollowUser(session.user.id, targetUserId);
      return NextResponse.json(result);
    }

    if (action === 'send_request') {
      const result = await sendFriendRequest(session.user.id, targetUserId);
      return NextResponse.json(result);
    }

    if (action === 'cancel_request') {
      const result = await cancelFriendRequest(session.user.id, targetUserId);
      return NextResponse.json(result);
    }

    if (action === 'accept_request') {
      const result = await acceptFriendRequest(session.user.id, targetUserId);
      return NextResponse.json(result);
    }

    if (action === 'remove_friend') {
      const result = await removeFriend(session.user.id, targetUserId);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Неизвестное действие.' }, { status: 400 });
  } catch (error) {
    console.error('people/action failed', error);
    return NextResponse.json({ error: 'Не удалось выполнить действие.' }, { status: 500 });
  }
}

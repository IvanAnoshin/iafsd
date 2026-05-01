import prisma from '@/lib/prisma';

export function sortFriendPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

export function initialsOf(firstName, lastName) {
  return `${String(firstName || '').trim().charAt(0)}${String(lastName || '').trim().charAt(0)}`.toUpperCase();
}

export function mapProfileUser(user, extra = {}) {
  const profile = user.publicProfile;
  return {
    id: user.id,
    name: `${user.firstName} ${user.lastName}`.trim(),
    handle: profile ? `@${profile.handle}` : '@user',
    handle_raw: profile?.handle || null,
    occupation: profile?.occupation || 'Участник Friendscape',
    city: profile?.city || 'Friendscape',
    tone: profile?.tone || 'violet',
    status: profile?.status || 'recent',
    initials: initialsOf(user.firstName, user.lastName),
    ...extra,
  };
}

async function ensureTargetUser(currentUserId, targetUserId, tx = prisma) {
  const targetId = Number(targetUserId);
  if (!targetId || targetId === currentUserId) {
    const error = new Error('Некорректный пользователь.');
    error.status = 400;
    throw error;
  }

  const targetUser = await tx.user.findUnique({ where: { id: targetId } });
  if (!targetUser) {
    const error = new Error('Пользователь не найден.');
    error.status = 404;
    throw error;
  }

  return targetUser;
}

export async function followUser(currentUserId, targetUserId, tx = prisma) {
  await ensureTargetUser(currentUserId, targetUserId, tx);
  const existing = await tx.subscription.findUnique({
    where: { fromUserId_toUserId: { fromUserId: currentUserId, toUserId: targetUserId } },
  });

  if (existing) {
    return { message: 'Вы уже подписаны.', created: false };
  }

  await tx.subscription.create({
    data: { fromUserId: currentUserId, toUserId: targetUserId },
  });
  return { message: 'Подписка оформлена.', created: true };
}

export async function unfollowUser(currentUserId, targetUserId, tx = prisma) {
  await ensureTargetUser(currentUserId, targetUserId, tx);
  const result = await tx.subscription.deleteMany({ where: { fromUserId: currentUserId, toUserId: targetUserId } });
  return { message: 'Подписка отменена.', removed: result.count > 0 };
}

export async function sendFriendRequest(currentUserId, targetUserId, tx = prisma) {
  await ensureTargetUser(currentUserId, targetUserId, tx);
  const [userAId, userBId] = sortFriendPair(currentUserId, targetUserId);
  const existingFriendship = await tx.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } } });
  if (existingFriendship) return { message: 'Вы уже в друзьях.', created: false, autoAccepted: false };

  const incoming = await tx.friendRequest.findUnique({
    where: { fromUserId_toUserId: { fromUserId: targetUserId, toUserId: currentUserId } },
  });

  if (incoming?.status === 'pending') {
    await tx.$transaction([
      tx.friendRequest.update({ where: { id: incoming.id }, data: { status: 'accepted' } }),
      tx.friendship.upsert({
        where: { userAId_userBId: { userAId, userBId } },
        update: {},
        create: { userAId, userBId },
      }),
    ]);
    return { message: 'Заявка принята.', created: false, autoAccepted: true };
  }

  const outgoing = await tx.friendRequest.findUnique({
    where: { fromUserId_toUserId: { fromUserId: currentUserId, toUserId: targetUserId } },
  });

  if (outgoing?.status === 'pending') {
    return { message: 'Заявка уже отправлена.', created: false, autoAccepted: false };
  }

  await tx.friendRequest.upsert({
    where: { fromUserId_toUserId: { fromUserId: currentUserId, toUserId: targetUserId } },
    update: { status: 'pending' },
    create: { fromUserId: currentUserId, toUserId: targetUserId, status: 'pending' },
  });

  return { message: 'Заявка отправлена.', created: true, autoAccepted: false };
}

export async function cancelFriendRequest(currentUserId, targetUserId, tx = prisma) {
  await ensureTargetUser(currentUserId, targetUserId, tx);
  await tx.friendRequest.deleteMany({ where: { fromUserId: currentUserId, toUserId: targetUserId, status: 'pending' } });
  return { message: 'Заявка отменена.' };
}

export async function acceptFriendRequest(currentUserId, targetUserId, tx = prisma) {
  await ensureTargetUser(currentUserId, targetUserId, tx);
  const incoming = await tx.friendRequest.findUnique({
    where: { fromUserId_toUserId: { fromUserId: targetUserId, toUserId: currentUserId } },
  });

  if (!incoming || incoming.status !== 'pending') {
    const error = new Error('Запрос не найден.');
    error.status = 404;
    throw error;
  }

  const [userAId, userBId] = sortFriendPair(currentUserId, targetUserId);
  await tx.$transaction([
    tx.friendRequest.update({ where: { id: incoming.id }, data: { status: 'accepted' } }),
    tx.friendship.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      update: {},
      create: { userAId, userBId },
    }),
  ]);

  return { message: 'Пользователь добавлен в друзья.', accepted: true };
}

export async function rejectFriendRequest(currentUserId, targetUserId, tx = prisma) {
  await ensureTargetUser(currentUserId, targetUserId, tx);
  const incoming = await tx.friendRequest.findUnique({
    where: { fromUserId_toUserId: { fromUserId: targetUserId, toUserId: currentUserId } },
  });

  if (!incoming || incoming.status !== 'pending') {
    const error = new Error('Запрос не найден.');
    error.status = 404;
    throw error;
  }

  await tx.friendRequest.update({ where: { id: incoming.id }, data: { status: 'rejected' } });
  return { message: 'Заявка отклонена.' };
}

export async function removeFriend(currentUserId, targetUserId, tx = prisma) {
  await ensureTargetUser(currentUserId, targetUserId, tx);
  const [userAId, userBId] = sortFriendPair(currentUserId, targetUserId);
  await tx.friendship.deleteMany({ where: { userAId, userBId } });
  return { message: 'Пользователь удалён из друзей.' };
}

export async function getIncomingFriendRequests(userId, tx = prisma) {
  const rows = await tx.friendRequest.findMany({
    where: { toUserId: userId, status: 'pending' },
    include: { fromUser: { include: { publicProfile: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((item) =>
    mapProfileUser(item.fromUser, {
      requestId: item.id,
      requestedAt: item.createdAt,
      status: item.status,
    })
  );
}

export async function getUserFriends(userId, tx = prisma) {
  const rows = await tx.friendship.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    include: {
      userA: { include: { publicProfile: true } },
      userB: { include: { publicProfile: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((item) => {
    const friend = item.userAId === userId ? item.userB : item.userA;
    return mapProfileUser(friend, { friendedAt: item.createdAt });
  });
}

export async function getUserFollowers(userId, tx = prisma) {
  const rows = await tx.subscription.findMany({
    where: { toUserId: userId },
    include: { fromUser: { include: { publicProfile: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((item) => mapProfileUser(item.fromUser, { subscribedAt: item.createdAt }));
}

export async function getUserFollowing(userId, tx = prisma) {
  const rows = await tx.subscription.findMany({
    where: { fromUserId: userId },
    include: { toUser: { include: { publicProfile: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((item) => mapProfileUser(item.toUser, { subscribedAt: item.createdAt }));
}


export async function getSocialCounts(userId, tx = prisma) {
  const [friendships, followersCount, subscriptionsCount] = await tx.$transaction([
    tx.friendship.count({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
    }),
    tx.subscription.count({ where: { toUserId: userId } }),
    tx.subscription.count({ where: { fromUserId: userId } }),
  ]);

  return {
    friendsCount: friendships,
    followersCount,
    subscriptionsCount,
  };
}

export async function getPendingIncomingFriendRequestsCount(userId, tx = prisma) {
  return tx.friendRequest.count({
    where: { toUserId: userId, status: 'pending' },
  });
}

export async function getRelationshipStatus(currentUserId, targetUserId, tx = prisma) {
  await ensureTargetUser(currentUserId, targetUserId, tx);
  const [userAId, userBId] = sortFriendPair(currentUserId, targetUserId);

  const [friendship, incomingRequest, outgoingRequest, following, followsYou] = await tx.$transaction([
    tx.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } } }),
    tx.friendRequest.findUnique({ where: { fromUserId_toUserId: { fromUserId: targetUserId, toUserId: currentUserId } } }),
    tx.friendRequest.findUnique({ where: { fromUserId_toUserId: { fromUserId: currentUserId, toUserId: targetUserId } } }),
    tx.subscription.findUnique({ where: { fromUserId_toUserId: { fromUserId: currentUserId, toUserId: targetUserId } } }),
    tx.subscription.findUnique({ where: { fromUserId_toUserId: { fromUserId: targetUserId, toUserId: currentUserId } } }),
  ]);

  return {
    relation: friendship
      ? 'friends'
      : incomingRequest?.status === 'pending'
        ? 'incoming_request'
        : outgoingRequest?.status === 'pending'
          ? 'outgoing_request'
          : 'none',
    isFollowing: Boolean(following),
    followsYou: Boolean(followsYou),
    incomingRequestStatus: incomingRequest?.status || null,
    outgoingRequestStatus: outgoingRequest?.status || null,
  };
}

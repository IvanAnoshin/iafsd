import prisma from '@/lib/prisma';
import { getMessengerObservabilityOverview } from '@/lib/chat-observability';

function startOfDaysAgo(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}

function relativeTime(dateValue) {
  if (!dateValue) return 'нет активности';
  const date = new Date(dateValue);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} д назад`;
}

function buildUserName(user) {
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Пользователь';
}

function buildHandle(user) {
  const handle = user.publicProfile?.handle || user.normalizedKey || `${user.firstName}.${user.lastName}`;
  return `@${String(handle).replace(/^@+/, '')}`;
}

function buildUserSummary(user) {
  const postsCount = user._count?.posts || 0;
  const commentsCount = user._count?.comments || 0;
  const sessionsCount = user._count?.sessions || 0;
  const trustedDevices = Array.isArray(user.devices)
    ? user.devices.filter((item) => item.trusted).length
    : 0;
  const friendsCount = (user.friendshipsA?.length || 0) + (user.friendshipsB?.length || 0);
  const followersCount = user._count?.subscriptionsIn || 0;
  const trustLabel = user.behavioralTrustLabel || 'uncertain';
  const openTickets = Array.isArray(user.supportTickets)
    ? user.supportTickets.filter((ticket) => ticket.status === 'open').length
    : 0;

  return {
    id: user.id,
    full_name: buildUserName(user),
    handle: buildHandle(user),
    created_at: user.createdAt,
    behavioral_trust_label: trustLabel,
    behavioral_updated_at: user.behavioralUpdatedAt,
    last_seen_at: user.sessions?.[0]?.lastSeenAt || null,
    metrics: {
      posts: postsCount,
      comments: commentsCount,
      friends: friendsCount,
      followers: followersCount,
      active_sessions: sessionsCount,
      trusted_devices: trustedDevices,
      open_tickets: openTickets,
    },
    profile: {
      bio: user.publicProfile?.bio || null,
      city: user.publicProfile?.city || null,
      occupation: user.publicProfile?.occupation || null,
      relationship_status: user.publicProfile?.relationshipStatus || null,
    },
    summary: `${postsCount} постов · ${followersCount} подписчиков · ${sessionsCount} сессий`,
    last_seen_label: relativeTime(user.sessions?.[0]?.lastSeenAt || user.createdAt),
  };
}

export async function getAdminOverview() {
  const now = new Date();
  const last7Days = startOfDaysAgo(7);
  const last30Days = startOfDaysAgo(30);

  const [
    totalUsers,
    newUsers7d,
    totalPosts,
    posts7d,
    totalComments,
    comments7d,
    pendingFriendRequests,
    totalSubscriptions,
    unreadNotifications,
    openSupportTickets,
    newReports,
    newMessageReports,
    openMessengerSafetyFlags,
    totalTrustedDevices,
    activeSessions,
    recentDfsnSessions,
    trustBuckets,
    recentAudit,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: last7Days } } }),
    prisma.post.count(),
    prisma.post.count({ where: { createdAt: { gte: last7Days } } }),
    prisma.comment.count(),
    prisma.comment.count({ where: { createdAt: { gte: last7Days } } }),
    prisma.friendRequest.count({ where: { status: 'pending' } }),
    prisma.subscription.count(),
    prisma.notification.count({ where: { isRead: false } }),
    prisma.supportTicket.count({ where: { status: 'open' } }),
    prisma.postReport.count({ where: { status: 'new' } }),
    prisma.chatMessageReport ? prisma.chatMessageReport.count({ where: { status: 'new' } }) : Promise.resolve(0),
    prisma.messengerSafetyFlag ? prisma.messengerSafetyFlag.count({ where: { status: 'open' } }) : Promise.resolve(0),
    prisma.userDevice.count({ where: { trusted: true } }),
    prisma.session.count({ where: { expiresAt: { gt: now } } }),
    prisma.dfsnSession.count({ where: { createdAt: { gte: last7Days } } }),
    prisma.user.groupBy({
      by: ['behavioralTrustLabel'],
      _count: { _all: true },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: { actorUser: { include: { publicProfile: true } } },
    }),
  ]);

  const [totalFriendships, totalConversations, messages7d, activeUsers30d, messengerObservability] = await Promise.all([
    prisma.friendship.count(),
    prisma.conversation.count(),
    prisma.chatMessage.count({ where: { createdAt: { gte: last7Days } } }),
    prisma.session.groupBy({
      by: ['userId'],
      where: { lastSeenAt: { gte: last30Days } },
    }),
    getMessengerObservabilityOverview(prisma),
  ]);

  const trustMap = Object.fromEntries(
    trustBuckets.map((bucket) => [bucket.behavioralTrustLabel || 'unknown', bucket._count._all])
  );

  return {
    generated_at: now,
    kpis: {
      users_total: totalUsers,
      users_new_7d: newUsers7d,
      users_active_30d: activeUsers30d.length,
      posts_total: totalPosts,
      posts_7d: posts7d,
      comments_total: totalComments,
      comments_7d: comments7d,
      friendships_total: totalFriendships,
      subscriptions_total: totalSubscriptions,
      pending_friend_requests: pendingFriendRequests,
      active_sessions: activeSessions,
      trusted_devices: totalTrustedDevices,
      conversations_total: totalConversations,
      messages_7d: messages7d,
      unread_notifications: unreadNotifications,
      open_support_tickets: openSupportTickets,
      new_post_reports: newReports,
      new_message_reports: newMessageReports,
      open_messenger_safety_flags: openMessengerSafetyFlags,
      dfsn_sessions_7d: recentDfsnSessions,
    },
    trust_distribution: {
      trusted: trustMap.trusted || 0,
      uncertain: trustMap.uncertain || 0,
      suspicious: trustMap.suspicious || 0,
      unknown: trustMap.unknown || 0,
    },
    messenger_observability: messengerObservability,
    recent_audit: recentAudit.map((row) => ({
      id: row.id,
      action: row.action,
      status: row.status,
      created_at: row.createdAt,
      actor: row.actorUser ? {
        id: row.actorUser.id,
        full_name: buildUserName(row.actorUser),
        handle: buildHandle(row.actorUser),
      } : null,
      entity_type: row.entityType,
      entity_id: row.entityId,
      route: row.route,
    })),
  };
}

export async function listAdminUsers({ q = '', trustLabel = '', sort = 'recent', limit = 20, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const query = String(q || '').trim();
  const trust = String(trustLabel || '').trim();

  const where = {};
  if (trust) where.behavioralTrustLabel = trust;
  if (query) {
    const terms = query.split(/\s+/).filter(Boolean);
    where.OR = [
      { firstName: { contains: query, mode: 'insensitive' } },
      { lastName: { contains: query, mode: 'insensitive' } },
      { normalizedKey: { contains: query.toLowerCase(), mode: 'insensitive' } },
      { publicProfile: { handle: { contains: query.replace(/^@+/, ''), mode: 'insensitive' } } },
      { publicProfile: { bio: { contains: query, mode: 'insensitive' } } },
      { publicProfile: { city: { contains: query, mode: 'insensitive' } } },
      { publicProfile: { occupation: { contains: query, mode: 'insensitive' } } },
      ...(terms.length > 1
        ? [{
            AND: terms.map((term) => ({
              OR: [
                { firstName: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
              ],
            })),
          }]
        : []),
    ];
  }

  const orderBy =
    sort === 'name'
      ? [{ lastName: 'asc' }, { firstName: 'asc' }]
      : sort === 'activity'
        ? [{ behavioralUpdatedAt: 'desc' }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }];

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy,
      take: safeLimit,
      skip: safeOffset,
      include: {
        publicProfile: true,
        sessions: {
          orderBy: { lastSeenAt: 'desc' },
          take: 1,
        },
        devices: true,
        friendshipsA: { select: { id: true } },
        friendshipsB: { select: { id: true } },
        supportTickets: {
          where: { status: 'open' },
          select: { id: true },
        },
        _count: {
          select: {
            posts: true,
            comments: true,
            sessions: true,
            subscriptionsIn: true,
          },
        },
      },
    }),
  ]);

  return {
    total,
    limit: safeLimit,
    offset: safeOffset,
    items: rows.map(buildUserSummary),
  };
}

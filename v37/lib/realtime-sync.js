import prisma from '@/lib/prisma';
import { emitUsersEvent } from '@/lib/chat-realtime';

function uniqueUserIds(userIds) {
  return [...new Set((userIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

async function countUnreadMessagesForUser(userId, db = prisma) {
  if (!db?.conversationMember || !db?.chatMessage) return 0;

  const memberships = await db.conversationMember.findMany({
    where: { userId: Number(userId), archivedAt: null },
    select: { conversationId: true, lastReadAt: true, clearedAt: true },
  });

  const hiddenIncoming = db?.messageRequest
    ? new Set((await db.messageRequest.findMany({
        where: { toUserId: Number(userId), status: 'pending' },
        select: { conversationId: true },
      })).map((item) => item.conversationId))
    : new Set();

  let count = 0;
  for (const membership of memberships) {
    if (hiddenIncoming.has(membership.conversationId)) continue;
    count += await db.chatMessage.count({
      where: {
        conversationId: membership.conversationId,
        deletedAt: null,
        senderId: { not: Number(userId) },
        createdAt: { gt: membership.lastReadAt || membership.clearedAt || new Date(0) },
      },
    });
  }
  return count;
}

export async function getUnreadSummary(userId, db = prisma) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    return {
      user_id: null,
      messages_unread: 0,
      notifications_unread: 0,
      incoming_requests: 0,
      chat_total: 0,
      total_badge: 0,
      timestamp: new Date().toISOString(),
    };
  }

  const [messagesUnread, notificationsUnread, incomingRequests] = await Promise.all([
    countUnreadMessagesForUser(numericUserId, db),
    db?.notification ? db.notification.count({ where: { userId: numericUserId, isRead: false } }) : 0,
    db?.messageRequest ? db.messageRequest.count({ where: { toUserId: numericUserId, status: 'pending' } }) : 0,
  ]);

  const chatTotal = Number(messagesUnread || 0) + Number(incomingRequests || 0);
  const totalBadge = chatTotal + Number(notificationsUnread || 0);

  return {
    user_id: numericUserId,
    messages_unread: Number(messagesUnread || 0),
    notifications_unread: Number(notificationsUnread || 0),
    incoming_requests: Number(incomingRequests || 0),
    chat_total: chatTotal,
    total_badge: totalBadge,
    timestamp: new Date().toISOString(),
  };
}

export async function emitUnreadSummary(userIds, db = prisma) {
  const ids = uniqueUserIds(userIds);
  if (!ids.length) return 0;
  let emitted = 0;
  for (const userId of ids) {
    const summary = await getUnreadSummary(userId, db);
    emitted += emitUsersEvent([userId], 'sync.unread', summary);
  }
  return emitted;
}

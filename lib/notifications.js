import prisma from '@/lib/prisma';
import { emitUsersEvent } from '@/lib/chat-realtime';
import { emitUnreadSummary } from '@/lib/realtime-sync';
import { isNotificationEnabled, getUserPreferences } from '@/lib/user-preferences';

function initialsOf(firstName, lastName) {
  return `${String(firstName || '').trim().charAt(0)}${String(lastName || '').trim().charAt(0)}`.toUpperCase() || 'U';
}

function hasNotificationsModel(db = prisma) {
  return Boolean(db?.notification);
}

function truncate(value, max = 120) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function makeJsonSafe(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function formatRelativeTime(value) {
  if (!value) return 'только что';
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));

  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} ${pluralize(minutes, ['минуту', 'минуты', 'минут'])} назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${pluralize(hours, ['час', 'часа', 'часов'])} назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${pluralize(days, ['день', 'дня', 'дней'])} назад`;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function pluralize(value, forms) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

const notificationInclude = {
  actorUser: {
    include: {
      publicProfile: true,
    },
  },
};

export function serializeNotification(notification) {
  const actor = notification?.actorUser;
  const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : 'Система';
  const handle = actor?.publicProfile?.handle ? `@${actor.publicProfile.handle}` : null;

  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    text: notification.body,
    target: notification.targetLabel || '',
    unread: !notification.isRead,
    created_at: notification.createdAt,
    read_at: notification.readAt,
    time: formatRelativeTime(notification.createdAt),
    actor: {
      id: actor?.id || null,
      name: actorName,
      handle,
      initials: initialsOf(actor?.firstName, actor?.lastName),
    },
    entity_type: notification.entityType || null,
    entity_id: notification.entityId || null,
    payload: notification.payload || null,
  };
}

export async function createNotification(input, db = prisma) {
  if (!hasNotificationsModel(db)) return null;

  const userId = Number(input?.userId);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  const actorUserId = input?.actorUserId == null ? null : Number(input.actorUserId);
  if (!input?.allowSelf && actorUserId && actorUserId === userId) return null;

  try {
    const preferences = await getUserPreferences(userId, db).catch(() => null);
    if (preferences && !isNotificationEnabled(input.type, preferences)) return null;

    const created = await db.notification.create({
      data: {
        userId,
        actorUserId: Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null,
        type: String(input.type || 'generic'),
        title: truncate(input.title, 120) || 'Новое уведомление',
        body: truncate(input.body, 240) || 'У вас новое уведомление.',
        targetLabel: truncate(input.targetLabel, 140),
        entityType: input.entityType ? String(input.entityType) : null,
        entityId: input.entityId == null ? null : String(input.entityId),
        payload: makeJsonSafe(input.payload),
      },
      include: notificationInclude,
    });
    const item = serializeNotification(created);
    const unreadCount = await countUnreadNotifications(userId, db);
    emitUsersEvent([userId], 'notification.created', { item, unread_count: unreadCount });
    await emitUnreadSummary([userId], db);
    return item;
  } catch (error) {
    console.error('notification create failed', error?.message || error);
    return null;
  }
}

export async function listNotifications(userId, options = {}, db = prisma) {
  if (!hasNotificationsModel(db)) {
    return { items: [], count: 0, unreadCount: 0 };
  }

  const take = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
  const unreadOnly = options.unreadOnly === true || options.unreadOnly === 'true' || options.unreadOnly === '1';

  const [items, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { isRead: false } : {}),
      },
      include: notificationInclude,
      orderBy: { createdAt: 'desc' },
      take,
    }),
    db.notification.count({ where: { userId, isRead: false } }),
  ]);

  return {
    items: items.map(serializeNotification),
    count: items.length,
    unreadCount,
  };
}

export async function countUnreadNotifications(userId, db = prisma) {
  if (!hasNotificationsModel(db)) return 0;
  return db.notification.count({ where: { userId, isRead: false } });
}

export async function markNotificationRead(userId, notificationId, db = prisma) {
  if (!hasNotificationsModel(db)) return null;

  const updated = await db.notification.updateMany({
    where: { id: Number(notificationId), userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });

  if (!updated.count) return null;

  const record = await db.notification.findUnique({ where: { id: Number(notificationId) }, include: notificationInclude });
  const item = record ? serializeNotification(record) : null;
  const unreadCount = await countUnreadNotifications(userId, db);
  if (item) emitUsersEvent([userId], 'notification.read', { item, unread_count: unreadCount });
  await emitUnreadSummary([userId], db);
  return item;
}

export async function markAllNotificationsRead(userId, db = prisma) {
  if (!hasNotificationsModel(db)) return { updated: 0, unreadCount: 0 };

  const result = await db.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });

  const payload = {
    updated: result.count,
    unreadCount: 0,
  };
  emitUsersEvent([userId], 'notification.read_all', payload);
  await emitUnreadSummary([userId], db);
  return payload;
}

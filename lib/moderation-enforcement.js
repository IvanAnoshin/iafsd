import prisma from '@/lib/prisma';

function restrictionApplies(restriction, surface) {
  if (!restriction) return false;
  if (restriction.type === 'ban') return true;
  if (restriction.type !== 'mute') return false;
  if (restriction.surface === 'global') return true;
  return restriction.surface === surface;
}

function restrictionMessage(restriction) {
  if (restriction.type === 'ban') return 'Аккаунт ограничен модерацией.';
  if (restriction.expiresAt) return 'Действие временно ограничено модерацией.';
  return 'Действие ограничено модерацией.';
}

export async function getActiveUserModerationRestriction(userId, surface = 'global', db = prisma) {
  if (!db?.userModerationRestriction) return null;
  const now = new Date();
  const rows = await db.userModerationRestriction.findMany({
    where: {
      userId: Number(userId),
      status: 'active',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  }).catch(() => []);
  return rows.find((row) => restrictionApplies(row, surface)) || null;
}

export async function ensureUserNotRestricted(userId, surface = 'global', db = prisma) {
  const restriction = await getActiveUserModerationRestriction(userId, surface, db);
  if (!restriction) return null;
  const error = new Error(restrictionMessage(restriction));
  error.status = 403;
  error.code = 'USER_MODERATION_RESTRICTED';
  error.restriction = {
    id: restriction.id,
    type: restriction.type,
    surface: restriction.surface,
    expires_at: restriction.expiresAt || null,
    reason: restriction.reason || null,
  };
  throw error;
}

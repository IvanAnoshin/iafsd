import prisma from '@/lib/prisma';
import { sortFriendPair } from '@/lib/social';

export const DEFAULT_USER_PREFERENCES = Object.freeze({
  profile_visibility: 'everyone',
  photo_visibility: 'connections',
  activity_visibility: 'connections',
  message_permission: 'everyone',
  message_requests_enabled: true,
  notify_messages: true,
  notify_message_requests: true,
  notify_comments: true,
  notify_reactions: true,
  notify_follows: true,
  appearance: 'system',
  vision_mode: 'none',
  reduced_motion: false,
});

const VISIBILITY_OPTIONS = new Set(['everyone', 'connections', 'friends', 'nobody']);
const MESSAGE_PERMISSION_OPTIONS = new Set(['everyone', 'connections', 'friends', 'requests_only']);
const APPEARANCE_OPTIONS = new Set(['system', 'light', 'dark']);
const VISION_MODE_OPTIONS = new Set(['none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']);

function normalizeChoice(value, allowed, fallback) {
  const choice = String(value || '').trim().toLowerCase();
  return allowed.has(choice) ? choice : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

export function serializeUserPreferences(record) {
  const source = record && typeof record === 'object' ? record : {};
  return {
    profile_visibility: normalizeChoice(source.profileVisibility, VISIBILITY_OPTIONS, DEFAULT_USER_PREFERENCES.profile_visibility),
    photo_visibility: normalizeChoice(source.photoVisibility, VISIBILITY_OPTIONS, DEFAULT_USER_PREFERENCES.photo_visibility),
    activity_visibility: normalizeChoice(source.activityVisibility, VISIBILITY_OPTIONS, DEFAULT_USER_PREFERENCES.activity_visibility),
    message_permission: normalizeChoice(source.messagePermission, MESSAGE_PERMISSION_OPTIONS, DEFAULT_USER_PREFERENCES.message_permission),
    message_requests_enabled: normalizeBoolean(source.messageRequestsEnabled, DEFAULT_USER_PREFERENCES.message_requests_enabled),
    notify_messages: normalizeBoolean(source.notifyMessages, DEFAULT_USER_PREFERENCES.notify_messages),
    notify_message_requests: normalizeBoolean(source.notifyMessageRequests, DEFAULT_USER_PREFERENCES.notify_message_requests),
    notify_comments: normalizeBoolean(source.notifyComments, DEFAULT_USER_PREFERENCES.notify_comments),
    notify_reactions: normalizeBoolean(source.notifyReactions, DEFAULT_USER_PREFERENCES.notify_reactions),
    notify_follows: normalizeBoolean(source.notifyFollows, DEFAULT_USER_PREFERENCES.notify_follows),
    appearance: normalizeChoice(source.appearance, APPEARANCE_OPTIONS, DEFAULT_USER_PREFERENCES.appearance),
    vision_mode: normalizeChoice(source.visionMode, VISION_MODE_OPTIONS, DEFAULT_USER_PREFERENCES.vision_mode),
    reduced_motion: normalizeBoolean(source.reducedMotion, DEFAULT_USER_PREFERENCES.reduced_motion),
  };
}

export async function ensureUserPreferences(userId, db = prisma) {
  if (!db?.userPreference) return { ...DEFAULT_USER_PREFERENCES };
  const existing = await db.userPreference.findUnique({ where: { userId: Number(userId) } });
  if (existing) return existing;
  return db.userPreference.create({ data: { userId: Number(userId) } });
}

export async function getUserPreferences(userId, db = prisma) {
  const record = await ensureUserPreferences(userId, db);
  return serializeUserPreferences(record);
}

export async function updateUserPreferences(userId, patch = {}, db = prisma) {
  if (!db?.userPreference) return DEFAULT_USER_PREFERENCES;
  const data = {
    profileVisibility: normalizeChoice(patch.profile_visibility, VISIBILITY_OPTIONS, DEFAULT_USER_PREFERENCES.profile_visibility),
    photoVisibility: normalizeChoice(patch.photo_visibility, VISIBILITY_OPTIONS, DEFAULT_USER_PREFERENCES.photo_visibility),
    activityVisibility: normalizeChoice(patch.activity_visibility, VISIBILITY_OPTIONS, DEFAULT_USER_PREFERENCES.activity_visibility),
    messagePermission: normalizeChoice(patch.message_permission, MESSAGE_PERMISSION_OPTIONS, DEFAULT_USER_PREFERENCES.message_permission),
    messageRequestsEnabled: normalizeBoolean(patch.message_requests_enabled, DEFAULT_USER_PREFERENCES.message_requests_enabled),
    notifyMessages: normalizeBoolean(patch.notify_messages, DEFAULT_USER_PREFERENCES.notify_messages),
    notifyMessageRequests: normalizeBoolean(patch.notify_message_requests, DEFAULT_USER_PREFERENCES.notify_message_requests),
    notifyComments: normalizeBoolean(patch.notify_comments, DEFAULT_USER_PREFERENCES.notify_comments),
    notifyReactions: normalizeBoolean(patch.notify_reactions, DEFAULT_USER_PREFERENCES.notify_reactions),
    notifyFollows: normalizeBoolean(patch.notify_follows, DEFAULT_USER_PREFERENCES.notify_follows),
    appearance: normalizeChoice(patch.appearance, APPEARANCE_OPTIONS, DEFAULT_USER_PREFERENCES.appearance),
    visionMode: normalizeChoice(patch.vision_mode, VISION_MODE_OPTIONS, DEFAULT_USER_PREFERENCES.vision_mode),
    reducedMotion: normalizeBoolean(patch.reduced_motion, DEFAULT_USER_PREFERENCES.reduced_motion),
  };

  const record = await db.userPreference.upsert({
    where: { userId: Number(userId) },
    update: data,
    create: { userId: Number(userId), ...data },
  });
  return serializeUserPreferences(record);
}

export async function getViewerRelation(viewerId, targetUserId, db = prisma) {
  const viewer = Number(viewerId);
  const target = Number(targetUserId);
  if (!Number.isInteger(viewer) || !Number.isInteger(target) || viewer <= 0 || target <= 0) {
    return { is_self: false, is_friend: false, has_connection: false };
  }
  if (viewer === target) {
    return { is_self: true, is_friend: true, has_connection: true };
  }
  const [userAId, userBId] = sortFriendPair(viewer, target);
  const [friendship, follows, followedBy] = await db.$transaction([
    db.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } }, select: { id: true } }),
    db.subscription.findUnique({ where: { fromUserId_toUserId: { fromUserId: viewer, toUserId: target } }, select: { id: true } }),
    db.subscription.findUnique({ where: { fromUserId_toUserId: { fromUserId: target, toUserId: viewer } }, select: { id: true } }),
  ]);
  const isFriend = Boolean(friendship);
  const hasConnection = Boolean(friendship || follows || followedBy);
  return {
    is_self: false,
    is_friend: isFriend,
    has_connection: hasConnection,
    follows: Boolean(follows),
    followed_by: Boolean(followedBy),
  };
}

export function isVisibilityAllowed(level, relation = {}) {
  const visibility = normalizeChoice(level, VISIBILITY_OPTIONS, DEFAULT_USER_PREFERENCES.profile_visibility);
  if (relation?.is_self) return true;
  if (visibility === 'everyone') return true;
  if (visibility === 'connections') return Boolean(relation?.has_connection);
  if (visibility === 'friends') return Boolean(relation?.is_friend);
  return false;
}

export function isMessagingAllowed(preferences, relation = {}) {
  const prefs = preferences || DEFAULT_USER_PREFERENCES;
  const permission = normalizeChoice(prefs.message_permission, MESSAGE_PERMISSION_OPTIONS, DEFAULT_USER_PREFERENCES.message_permission);
  if (relation?.is_self) {
    return { allowed: true, requires_request: false, reason: 'self' };
  }
  if (permission === 'everyone') {
    return { allowed: true, requires_request: false, reason: 'everyone' };
  }
  if (permission === 'connections' && relation?.has_connection) {
    return { allowed: true, requires_request: false, reason: 'connections' };
  }
  if (permission === 'friends' && relation?.is_friend) {
    return { allowed: true, requires_request: false, reason: 'friends' };
  }
  if (prefs.message_requests_enabled) {
    return { allowed: false, requires_request: true, reason: 'request_required' };
  }
  return { allowed: false, requires_request: false, reason: 'blocked_by_preference' };
}

const NOTIFICATION_GROUPS = {
  messages: new Set(['message', 'call_invite', 'missed_call', 'call_busy']),
  message_requests: new Set(['message_request', 'message_request_accepted']),
  comments: new Set(['comment']),
  reactions: new Set(['like', 'comment_like']),
  follows: new Set(['follow', 'friend_request', 'friend_request_accepted']),
};

export function isNotificationEnabled(notificationType, preferences) {
  const prefs = preferences || DEFAULT_USER_PREFERENCES;
  const type = String(notificationType || '').trim();
  if (!type) return true;
  if (NOTIFICATION_GROUPS.messages.has(type)) return Boolean(prefs.notify_messages);
  if (NOTIFICATION_GROUPS.message_requests.has(type)) return Boolean(prefs.notify_message_requests);
  if (NOTIFICATION_GROUPS.comments.has(type)) return Boolean(prefs.notify_comments);
  if (NOTIFICATION_GROUPS.reactions.has(type)) return Boolean(prefs.notify_reactions);
  if (NOTIFICATION_GROUPS.follows.has(type)) return Boolean(prefs.notify_follows);
  return true;
}

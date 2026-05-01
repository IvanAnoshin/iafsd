import prisma from '@/lib/prisma';

const DEFAULT_SETTINGS = {
  defaultTab: 'following',
  sortMode: 'recent',
  showFriends: true,
  showFollowing: true,
  showGlobal: true,
  savedFirst: false,
};

const TAB_SET = new Set(['friends', 'following', 'global']);
const SORT_SET = new Set(['recent', 'popular']);

export function normalizeDefaultTab(value) {
  const next = String(value || '').trim().toLowerCase();
  return TAB_SET.has(next) ? next : DEFAULT_SETTINGS.defaultTab;
}

export function normalizeSortMode(value) {
  const next = String(value || '').trim().toLowerCase();
  return SORT_SET.has(next) ? next : DEFAULT_SETTINGS.sortMode;
}

export function serializeFeedSettings(record) {
  const base = record || DEFAULT_SETTINGS;
  return {
    default_tab: normalizeDefaultTab(base.defaultTab),
    sort_mode: normalizeSortMode(base.sortMode),
    show_friends: Boolean(base.showFriends ?? DEFAULT_SETTINGS.showFriends),
    show_following: Boolean(base.showFollowing ?? DEFAULT_SETTINGS.showFollowing),
    show_global: Boolean(base.showGlobal ?? DEFAULT_SETTINGS.showGlobal),
    saved_first: Boolean(base.savedFirst ?? DEFAULT_SETTINGS.savedFirst),
    persistence: record ? 'database' : 'memory',
  };
}

export function sanitizeFeedSettings(input = {}) {
  return {
    default_tab: normalizeDefaultTab(input.default_tab),
    sort_mode: normalizeSortMode(input.sort_mode),
    show_friends: typeof input.show_friends === 'boolean' ? input.show_friends : DEFAULT_SETTINGS.showFriends,
    show_following: typeof input.show_following === 'boolean' ? input.show_following : DEFAULT_SETTINGS.showFollowing,
    show_global: typeof input.show_global === 'boolean' ? input.show_global : DEFAULT_SETTINGS.showGlobal,
    saved_first: typeof input.saved_first === 'boolean' ? input.saved_first : DEFAULT_SETTINGS.savedFirst,
  };
}

export function getVisibleFeedChannels(record) {
  const settings = serializeFeedSettings(record);
  return {
    friends: settings.show_friends,
    following: settings.show_following,
    global: settings.show_global,
  };
}

export async function ensureUserFeedSettings(userId, tx = prisma) {
  if (!tx?.userFeedSettings) {
    return { ...DEFAULT_SETTINGS, userId, __fallback: true };
  }

  try {
    const existing = await tx.userFeedSettings.findUnique({ where: { userId } });
    if (existing) return existing;

    try {
      return await tx.userFeedSettings.create({
        data: {
          userId,
          ...DEFAULT_SETTINGS,
        },
      });
    } catch (createError) {
      if (createError?.code === 'P2002') {
        const concurrent = await tx.userFeedSettings.findUnique({ where: { userId } });
        if (concurrent) return concurrent;
      }
      throw createError;
    }
  } catch (error) {
    console.warn('feed settings fallback enabled:', error?.code || error?.message || error);
    return { ...DEFAULT_SETTINGS, userId, __fallback: true };
  }
}

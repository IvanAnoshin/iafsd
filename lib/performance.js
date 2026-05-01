export const PERF_LIMITS = Object.freeze({
  feedPosts: { default: 30, max: 50 },
  profilePosts: { default: 20, max: 40 },
  communityPosts: { default: 20, max: 50 },
  mediaItems: { default: 40, max: 80 },
  previewComments: { default: 3, max: 8 },
});

export function parsePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(1, Math.min(safe, max));
}

export function parseDateCursor(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function buildCreatedBeforeWhere(cursor) {
  const date = parseDateCursor(cursor);
  return date ? { createdAt: { lt: date } } : {};
}

export function getNextCreatedAtCursor(items, limit) {
  const list = Array.isArray(items) ? items : [];
  if (list.length < limit) return null;
  const last = list[list.length - 1];
  return last?.createdAt?.toISOString?.() || null;
}

function buildRepostOriginalInclude(viewerId) {
  return {
    author: true,
    community: true,
    votes: { select: { userId: true, value: true } },
    saves: viewerId > 0
      ? { where: { userId: viewerId }, select: { userId: true }, take: 1 }
      : { where: { userId: -1 }, select: { userId: true }, take: 1 },
    _count: { select: { comments: true, saves: true, reposts: true } },
  };
}

export function buildPostListInclude(currentUserId, { commentsTake = PERF_LIMITS.previewComments.default } = {}) {
  const viewerId = Number(currentUserId || 0);
  const commentLimit = parsePositiveInt(commentsTake, PERF_LIMITS.previewComments.default, PERF_LIMITS.previewComments.max);

  return {
    author: true,
    community: true,
    repostOf: { include: buildRepostOriginalInclude(viewerId) },
    comments: {
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: commentLimit,
      include: {
        author: true,
        replyToComment: {
          include: {
            author: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    },
    votes: { select: { userId: true, value: true } },
    saves: viewerId > 0
      ? { where: { userId: viewerId }, select: { userId: true }, take: 1 }
      : { where: { userId: -1 }, select: { userId: true }, take: 1 },
    _count: { select: { comments: true, saves: true, reposts: true } },
  };
}

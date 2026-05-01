import prisma from '@/lib/prisma';
import { serializePostsForViewer } from '@/lib/posts';
import { searchCommunities as searchCommunitiesFromStore } from '@/lib/communities';

function normalizeQuery(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function tokenize(value) {
  return normalizeQuery(value)
    .toLowerCase()
    .split(' ')
    .map((item) => item.trim())
    .filter(Boolean);
}

function initialsOf(firstName, lastName) {
  return `${String(firstName || '').trim().charAt(0)}${String(lastName || '').trim().charAt(0)}`.toUpperCase();
}

function mapSearchUser(user, extra = {}) {
  const profile = user?.publicProfile;
  return {
    id: user.id,
    name: `${user.firstName} ${user.lastName}`.trim(),
    handle: profile ? `@${profile.handle}` : '@user',
    handle_raw: profile?.handle || null,
    bio: profile?.bio || null,
    occupation: profile?.occupation || 'Участник Friendscape',
    city: profile?.city || 'Friendscape',
    tone: profile?.tone || 'violet',
    status: profile?.status || 'recent',
    initials: initialsOf(user.firstName, user.lastName),
    ...extra,
  };
}

function buildUserHaystack(user) {
  const profile = user?.publicProfile;
  return [
    user?.firstName,
    user?.lastName,
    `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
    profile?.handle,
    profile?.bio,
    profile?.occupation,
    profile?.city,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildPostHaystack(post) {
  const payload = post?.payload && typeof post.payload === 'object' ? post.payload : {};
  return [
    post?.text,
    post?.author?.firstName,
    post?.author?.lastName,
    `${post?.author?.firstName || ''} ${post?.author?.lastName || ''}`.trim(),
    payload?.title,
    payload?.desc,
    payload?.domain,
    payload?.innerTitle,
    payload?.innerDesc,
    payload?.reason,
    payload?.meta,
    post?.location,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function rankTextMatch(haystack, tokens) {
  if (!tokens.length) return 0;
  let score = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) return -1;
    if (haystack.startsWith(token)) score += 6;
    score += 2;
  }
  return score;
}

function rankUser(user, tokens) {
  const profile = user?.publicProfile;
  const haystack = buildUserHaystack(user);
  const textScore = rankTextMatch(haystack, tokens);
  if (textScore < 0) return -1;

  let score = textScore;
  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim().toLowerCase();
  const handle = String(profile?.handle || '').toLowerCase();
  const city = String(profile?.city || '').toLowerCase();
  const occupation = String(profile?.occupation || '').toLowerCase();

  for (const token of tokens) {
    if (fullName.startsWith(token)) score += 8;
    if (handle.startsWith(token)) score += 10;
    if (handle.includes(token)) score += 4;
    if (city.startsWith(token)) score += 3;
    if (occupation.includes(token)) score += 2;
  }

  if (profile?.status === 'online') score += 1;
  score += Number(profile?.mutualHint || 0) * 0.15;
  return score;
}

function rankPost(post, tokens) {
  const haystack = buildPostHaystack(post);
  const textScore = rankTextMatch(haystack, tokens);
  if (textScore < 0) return -1;

  let score = textScore;
  const payload = post?.payload && typeof post.payload === 'object' ? post.payload : {};
  const text = String(post?.text || '').toLowerCase();
  const title = String(payload?.title || '').toLowerCase();
  const author = `${post?.author?.firstName || ''} ${post?.author?.lastName || ''}`.trim().toLowerCase();

  for (const token of tokens) {
    if (text.startsWith(token)) score += 8;
    if (title.startsWith(token)) score += 6;
    if (author.startsWith(token)) score += 4;
  }

  score += Number(post?.votes?.length || 0) * 0.2;
  score += Number(post?.comments?.length || 0) * 0.25;
  return score;
}

function buildFriendMap(friendships) {
  const map = new Map();
  for (const item of friendships) {
    if (!map.has(item.userAId)) map.set(item.userAId, new Set());
    if (!map.has(item.userBId)) map.set(item.userBId, new Set());
    map.get(item.userAId).add(item.userBId);
    map.get(item.userBId).add(item.userAId);
  }
  return map;
}

function computeMutualCount(currentUserId, targetUserId, friendMap, fallback = 0) {
  const currentFriends = friendMap.get(currentUserId) || new Set();
  const targetFriends = friendMap.get(targetUserId) || new Set();
  let count = 0;
  currentFriends.forEach((friendId) => {
    if (targetFriends.has(friendId)) count += 1;
  });
  return Math.max(count, Number(fallback || 0));
}

export async function searchUsers(currentUserId, rawQuery, { limit = 12, includeCurrentUser = false } = {}, db = prisma) {
  const query = normalizeQuery(rawQuery);
  const tokens = tokenize(query);
  if (!tokens.length) {
    return { query, users: [] };
  }

  const users = await db.user.findMany({
    include: { publicProfile: true },
    orderBy: [{ createdAt: 'desc' }],
    take: 200,
  });

  const ranked = [];
  for (const user of users) {
    if (!includeCurrentUser && user.id === currentUserId) continue;
    const score = rankUser(user, tokens);
    if (score < 0) continue;
    ranked.push({ user, score });
  }

  ranked.sort((left, right) => right.score - left.score || String(left.user.publicProfile?.handle || '').localeCompare(String(right.user.publicProfile?.handle || '')));
  const top = ranked.slice(0, limit);
  const targetIds = top.map((item) => item.user.id);
  if (!targetIds.length) {
    return { query, users: [] };
  }

  const [friendships, outgoingRequests, incomingRequests, subscriptionsOut, subscriptionsIn, followerCounts, friendCounts] = await Promise.all([
    db.friendship.findMany({
      where: {
        OR: [
          { userAId: { in: [currentUserId, ...targetIds] } },
          { userBId: { in: [currentUserId, ...targetIds] } },
        ],
      },
    }),
    db.friendRequest.findMany({
      where: { fromUserId: currentUserId, toUserId: { in: targetIds }, status: 'pending' },
      select: { toUserId: true },
    }),
    db.friendRequest.findMany({
      where: { fromUserId: { in: targetIds }, toUserId: currentUserId, status: 'pending' },
      select: { fromUserId: true },
    }),
    db.subscription.findMany({
      where: { fromUserId: currentUserId, toUserId: { in: targetIds } },
      select: { toUserId: true },
    }),
    db.subscription.findMany({
      where: { fromUserId: { in: targetIds }, toUserId: currentUserId },
      select: { fromUserId: true },
    }),
    db.subscription.groupBy({ by: ['toUserId'], where: { toUserId: { in: targetIds } }, _count: { _all: true } }),
    db.friendship.findMany({
      where: {
        OR: [
          { userAId: { in: targetIds } },
          { userBId: { in: targetIds } },
        ],
      },
      select: { userAId: true, userBId: true },
    }),
  ]);

  const friendMap = buildFriendMap(friendships);
  const followerMap = new Map(followerCounts.map((item) => [item.toUserId, item._count._all]));
  const currentFriendIds = new Set((friendMap.get(currentUserId) && Array.from(friendMap.get(currentUserId))) || []);
  const outgoingIds = new Set(outgoingRequests.map((item) => item.toUserId));
  const incomingIds = new Set(incomingRequests.map((item) => item.fromUserId));
  const followingIds = new Set(subscriptionsOut.map((item) => item.toUserId));
  const followsYouIds = new Set(subscriptionsIn.map((item) => item.fromUserId));

  const friendCountMap = new Map();
  for (const item of friendCounts) {
    friendCountMap.set(item.userAId, (friendCountMap.get(item.userAId) || 0) + 1);
    friendCountMap.set(item.userBId, (friendCountMap.get(item.userBId) || 0) + 1);
  }

  const results = top.map((item) => {
    const targetId = item.user.id;
    const relation = currentFriendIds.has(targetId)
      ? 'friends'
      : incomingIds.has(targetId)
        ? 'incoming_request'
        : outgoingIds.has(targetId)
          ? 'outgoing_request'
          : 'none';
    const mutualCount = computeMutualCount(currentUserId, targetId, friendMap, item.user.publicProfile?.mutualHint || 0);

    return mapSearchUser(item.user, {
      relation,
      isFollowing: followingIds.has(targetId),
      followsYou: followsYouIds.has(targetId),
      mutualCount,
      mutualHint: mutualCount ? `${mutualCount} общих знакомых` : 'Пока без общих знакомых',
      friendsCount: Number(friendCountMap.get(targetId) || 0),
      followersCount: Number(followerMap.get(targetId) || 0),
      score: Number(item.score.toFixed(2)),
    });
  });

  return { query, users: results };
}

export async function searchPosts(currentUserId, rawQuery, { limit = 18 } = {}, db = prisma) {
  const query = normalizeQuery(rawQuery);
  const tokens = tokenize(query);
  if (!tokens.length) {
    return { query, posts: [] };
  }

  const posts = await db.post.findMany({
    include: {
      author: true,
      comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
      votes: true,
      saves: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 120,
  });

  const ranked = [];
  for (const post of posts) {
    const score = rankPost(post, tokens);
    if (score < 0) continue;
    ranked.push({ post, score });
  }

  ranked.sort((left, right) => right.score - left.score || new Date(right.post.createdAt).getTime() - new Date(left.post.createdAt).getTime());
  const serialized = await serializePostsForViewer(ranked.slice(0, limit).map((item) => item.post), currentUserId, db);

  const withScore = serialized.map((post) => {
    const match = ranked.find((item) => item.post.id === post.id);
    return {
      ...post,
      search_score: match ? Number(match.score.toFixed(2)) : 0,
    };
  });

  return { query, posts: withScore };
}

export async function searchCommunities(currentUserId, rawQuery, options = {}, db = prisma) {
  return searchCommunitiesFromStore(currentUserId, rawQuery, options, db);
}

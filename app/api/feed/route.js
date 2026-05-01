import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession } from '@/lib/auth';
import { ensureUserFeedSettings, getVisibleFeedChannels, serializeFeedSettings } from '@/lib/feed-settings';
import { canViewerAccessPost, serializePostsForViewer } from '@/lib/posts';
import { buildCreatedBeforeWhere, buildPostListInclude, getNextCreatedAtCursor, parsePositiveInt, PERF_LIMITS } from '@/lib/performance';

async function getFeedRelations(userId) {
  const [friendships, following, communityMemberships] = await Promise.all([
    prisma.friendship.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: { userAId: true, userBId: true },
    }),
    prisma.subscription.findMany({
      where: { fromUserId: userId },
      select: { toUserId: true },
    }),
    prisma.communityMember.findMany({
      where: { userId, status: 'active' },
      select: { communityId: true },
    }).catch(() => []),
  ]);

  return {
    friendIds: friendships.map((item) => (item.userAId === userId ? item.userBId : item.userAId)).filter(Boolean),
    followingIds: following.map((item) => item.toUserId).filter(Boolean),
    memberCommunityIds: communityMemberships.map((item) => item.communityId).filter(Boolean),
  };
}

function buildFeedFallbackPayload(session, limit) {
  return {
    user: session?.user ? {
      id: session.user.id,
      first_name: session.user.firstName,
      last_name: session.user.lastName,
    } : null,
    settings: serializeFeedSettings(null),
    posts: [],
    page: {
      limit,
      has_more: false,
      next_cursor: null,
    },
    degraded: true,
  };
}

function withFeedChannel(post, viewerId, relationSets) {
  const payload = post?.payload && typeof post.payload === 'object' ? post.payload : {};
  let feedChannel = 'global';

  if (post.communityId) {
    feedChannel = 'communities';
  } else if (Number(post.authorId) === Number(viewerId)) {
    feedChannel = 'following';
  } else if (relationSets.friendIds.has(Number(post.authorId))) {
    feedChannel = 'friends';
  } else if (relationSets.followingIds.has(Number(post.authorId))) {
    feedChannel = 'following';
  }

  return {
    ...post,
    payload: {
      ...payload,
      feedChannel,
    },
  };
}

export async function GET(request) {
  let session = null;

  try {
    session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parsePositiveInt(searchParams.get('limit'), PERF_LIMITS.feedPosts.default, PERF_LIMITS.feedPosts.max);
    const cursorWhere = buildCreatedBeforeWhere(searchParams.get('cursor'));

    const settingsRecord = await ensureUserFeedSettings(session.user.id);
    const settings = serializeFeedSettings(settingsRecord);
    const visibleChannels = getVisibleFeedChannels(settingsRecord);
    const relations = await getFeedRelations(session.user.id);
    const friendIds = [...new Set(relations.friendIds)];
    const followingIds = [...new Set(relations.followingIds)];
    const memberCommunityIds = [...new Set(relations.memberCommunityIds)];

    const personalClauses = [
      { communityId: null, visibility: 'public' },
      { communityId: null, authorId: session.user.id },
    ];

    if (friendIds.length) {
      personalClauses.push({ communityId: null, authorId: { in: friendIds }, visibility: { in: ['public', 'friends', 'followers'] } });
    }

    if (followingIds.length) {
      personalClauses.push({ communityId: null, authorId: { in: followingIds }, visibility: { in: ['public', 'followers'] } });
    }

    const communityClauses = visibleChannels.communities ? [
      { communityId: { not: null }, visibility: 'public', community: { visibility: 'public' } },
      ...(memberCommunityIds.length ? [{ communityId: { in: memberCommunityIds }, visibility: { in: ['public', 'community'] } }] : []),
    ] : [];

    const rows = await prisma.post.findMany({
      where: {
        status: 'visible',
        ...cursorWhere,
        OR: [
          ...personalClauses,
          ...communityClauses,
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: buildPostListInclude(session.user.id),
    });

    const relationSets = {
      friendIds: new Set(friendIds),
      followingIds: new Set(followingIds),
    };

    const accessible = [];
    for (const post of rows) {
      if (accessible.length >= limit) break;
      if (!(await canViewerAccessPost(post, session.user.id))) continue;
      const withChannel = withFeedChannel(post, session.user.id, relationSets);
      if (withChannel.communityId && !visibleChannels.communities) continue;
      const channel = withChannel.payload?.feedChannel || 'global';
      if (channel === 'friends' && !visibleChannels.friends) continue;
      if (channel === 'following' && !visibleChannels.following) continue;
      if (channel === 'global' && !visibleChannels.global) continue;
      accessible.push(withChannel);
    }

    return NextResponse.json({
      user: {
        id: session.user.id,
        first_name: session.user.firstName,
        last_name: session.user.lastName,
      },
      settings,
      posts: await serializePostsForViewer(accessible, session.user.id),
      page: {
        limit,
        has_more: rows.length > limit,
        next_cursor: rows.length > limit ? getNextCreatedAtCursor(rows.slice(0, limit), limit) : null,
      },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.warn('feed/get fallback enabled', error?.message || error);
    if (!session?.user) {
      return NextResponse.json({ error: 'Не удалось загрузить ленту.' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parsePositiveInt(searchParams.get('limit'), PERF_LIMITS.feedPosts.default, PERF_LIMITS.feedPosts.max);
    return NextResponse.json(buildFeedFallbackPayload(session, limit), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

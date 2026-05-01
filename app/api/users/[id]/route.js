import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession } from '@/lib/auth';
import { ensureUserPublicProfile, normalizeProfileInterests, normalizeProfilePersonalDetails } from '@/lib/profile';
import { getSocialCounts } from '@/lib/social';
import {
  DEFAULT_USER_PREFERENCES,
  getUserPreferences,
  getViewerRelation,
  isVisibilityAllowed,
} from '@/lib/user-preferences';

function sortFriendPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

function buildMutualText(count) {
  if (!count) return 'Пока без общих знакомых';
  return `${count} общих знакомых`;
}

function initialsOf(firstName, lastName) {
  return `${String(firstName || '').trim().charAt(0)}${String(lastName || '').trim().charAt(0)}`.toUpperCase();
}

function buildUserProfileFallback(userId) {
  return {
    profile: {
      id: userId,
      name: 'Пользователь Friendscape',
      first_name: 'Пользователь',
      last_name: '',
      handle: '@friendscape',
      handle_raw: 'friendscape',
      bio: '',
      occupation: 'Участник Friendscape',
      city: 'Friendscape',
      relationship_status: '',
      personal_details: normalizeProfilePersonalDetails({}),
      tone: 'violet',
      cover_tone: 'violet',
      avatar_url: '',
      cover_url: '',
      interests: [],
      status: 'recent',
      initials: 'F',
      mutual: 'Активность временно недоступна',
      mutualCount: 0,
      followersCount: 0,
      subscriptionsCount: 0,
      friendsCount: 0,
      relation: 'none',
      isFollowing: false,
      followsYou: false,
      privacy: {
        profile_restricted: false,
        activity_hidden: false,
        media_hidden: false,
        communities_hidden: false,
      },
    },
    degraded: true,
  };
}

export async function GET(request, { params }) {
  let session = null;

  try {
    session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    const userId = Number((await params).id);
    if (!userId) {
      return NextResponse.json({ error: 'Некорректный пользователь.' }, { status: 400 });
    }

    const ensured = await ensureUserPublicProfile(userId);
    if (!ensured?.publicProfile) {
      return NextResponse.json({ error: 'Профиль не найден.' }, { status: 404 });
    }

    const profile = {
      ...ensured.publicProfile,
      user: ensured,
    };

    const [friendships, targetFriendships, incomingRequest, outgoingRequest, isFollowing, followsYou] = await Promise.all([
      prisma.friendship.findMany({
        where: { OR: [{ userAId: session.user.id }, { userBId: session.user.id }] },
      }),
      prisma.friendship.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
      }),
      prisma.friendRequest.findUnique({
        where: { fromUserId_toUserId: { fromUserId: userId, toUserId: session.user.id } },
      }),
      prisma.friendRequest.findUnique({
        where: { fromUserId_toUserId: { fromUserId: session.user.id, toUserId: userId } },
      }),
      prisma.subscription.findUnique({
        where: { fromUserId_toUserId: { fromUserId: session.user.id, toUserId: userId } },
      }),
      prisma.subscription.findUnique({
        where: { fromUserId_toUserId: { fromUserId: userId, toUserId: session.user.id } },
      }),
    ]);

    const socialCounts = await getSocialCounts(userId, prisma);

    let preferences = DEFAULT_USER_PREFERENCES;
    let relation = {
      is_self: session.user.id === userId,
      is_friend: false,
      has_connection: false,
    };

    try {
      preferences = await getUserPreferences(userId, prisma);
      relation = await getViewerRelation(session.user.id, userId, prisma);
    } catch (privacyError) {
      console.error('users/get privacy fallback', privacyError);
    }

    const currentFriendIds = new Set(friendships.map((item) => (item.userAId === session.user.id ? item.userBId : item.userAId)));
    const targetFriendIds = new Set(targetFriendships.map((item) => (item.userAId === userId ? item.userBId : item.userAId)));
    let mutualCount = 0;
    currentFriendIds.forEach((friendId) => {
      if (targetFriendIds.has(friendId)) mutualCount += 1;
    });

    const canSeeProfile = isVisibilityAllowed(preferences.profile_visibility, relation);
    const canSeeActivity = isVisibilityAllowed(preferences.activity_visibility, relation);
    const canSeePhotos = isVisibilityAllowed(preferences.photo_visibility, relation);
    const canSeeCommunities = isVisibilityAllowed(preferences.community_visibility, relation);

    const [userAId, userBId] = sortFriendPair(session.user.id, userId);
    const friendship = await prisma.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } } });

    return NextResponse.json({
      profile: {
        id: profile.user.id,
        name: `${profile.user.firstName} ${profile.user.lastName}`.trim(),
        first_name: profile.user.firstName,
        last_name: profile.user.lastName,
        handle: `@${profile.handle}`,
        handle_raw: profile.handle,
        bio: canSeeProfile ? profile.bio || '' : '',
        occupation: canSeeProfile ? profile.occupation || '' : '',
        city: canSeeProfile ? profile.city || '' : '',
        relationship_status: canSeeProfile ? profile.relationshipStatus || '' : '',
        personal_details: canSeeProfile ? normalizeProfilePersonalDetails(profile.personalDetails || {}) : normalizeProfilePersonalDetails({}),
        tone: profile.tone,
        cover_tone: canSeeProfile ? profile.coverTone || profile.tone || 'violet' : profile.tone || 'violet',
        avatar_url: canSeeProfile ? profile.avatarUrl || '' : '',
        cover_url: canSeeProfile ? profile.coverUrl || '' : '',
        interests: canSeeProfile ? normalizeProfileInterests(profile.interests || []) : [],
        status: profile.status,
        initials: initialsOf(profile.user.firstName, profile.user.lastName),
        mutual: canSeeActivity ? buildMutualText(Math.max(mutualCount, profile.mutualHint || 0)) : 'Активность скрыта',
        mutualCount: canSeeActivity ? Math.max(mutualCount, profile.mutualHint || 0) : 0,
        followersCount: canSeeActivity ? socialCounts.followersCount : 0,
        subscriptionsCount: canSeeActivity ? socialCounts.subscriptionsCount : 0,
        friendsCount: canSeeActivity ? socialCounts.friendsCount : 0,
        relation: friendship ? 'friends' : incomingRequest?.status === 'pending' ? 'incoming_request' : outgoingRequest?.status === 'pending' ? 'outgoing_request' : 'none',
        isFollowing: Boolean(isFollowing),
        followsYou: Boolean(followsYou),
        privacy: {
          profile_restricted: !canSeeProfile,
          activity_hidden: !canSeeActivity,
          media_hidden: !canSeePhotos,
          communities_hidden: !canSeeCommunities,
        },
      },
    });
  } catch (error) {
    console.warn('users/get fallback enabled', error?.message || error);
    if (!session?.user) {
      return NextResponse.json({ error: 'Не удалось загрузить профиль.' }, { status: 500 });
    }

    const userId = Number((await params).id);
    return NextResponse.json(buildUserProfileFallback(userId || 0), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

import crypto from 'node:crypto';
import prisma from '@/lib/prisma';
import { normalizePostText, serializePostsForViewer, serializePostForViewer } from '@/lib/posts';
import { buildCreatedBeforeWhere, buildPostListInclude, getNextCreatedAtCursor, parsePositiveInt, PERF_LIMITS } from '@/lib/performance';
import { getUserPreferences, getViewerRelation, isVisibilityAllowed } from '@/lib/user-preferences';
import { isCommunityUploadUrl } from '@/lib/community-media';
import { createNotification } from '@/lib/notifications';
import { assertMediaReferencesBelongToScope, sanitizeClientMediaUrl } from '@/lib/media-security';

const COMMUNITY_ROLES = new Set(['owner', 'admin', 'moderator', 'member']);
const COMMUNITY_VISIBILITIES = new Set(['public', 'closed', 'private']);
const AVATAR_TONES = new Set(['violet', 'blue', 'green', 'orange', 'stone']);
const MANAGER_ROLES = new Set(['owner', 'admin', 'moderator']);
const ADMIN_ROLES = new Set(['owner', 'admin']);
const POST_MANAGER_ROLES = new Set(['owner', 'admin', 'moderator']);
const COMMUNITY_POST_ACTIONS = new Set(['hide', 'restore', 'delete', 'pin', 'unpin']);
const COMMUNITY_COMMENT_ACTIONS = new Set(['hide', 'restore', 'delete']);
const COMMUNITY_MEMBER_ACTIONS = new Set(['mute', 'unmute', 'ban', 'unban']);

function httpError(message, status = 400, code = 'COMMUNITY_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeQuery(value, limit = 80) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

export function normalizeCommunitySlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function normalizeVisibility(value) {
  const next = String(value || 'public').trim().toLowerCase();
  return COMMUNITY_VISIBILITIES.has(next) ? next : 'public';
}

function normalizePermission(value, fallback = 'members') {
  const next = String(value || fallback).trim().toLowerCase();
  return ['everyone', 'members', 'verified', 'moderators', 'owner'].includes(next) ? next : fallback;
}

function normalizeTone(value, fallback = 'violet') {
  const next = String(value || '').trim().toLowerCase();
  return AVATAR_TONES.has(next) ? next : fallback;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  return tags
    .map((tag) => String(tag || '').trim().toLowerCase().replace(/^#/, ''))
    .filter(Boolean)
    .filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    })
    .slice(0, 10);
}

function normalizeRules(input) {
  const rawRules = Array.isArray(input) ? input : [];
  return rawRules
    .map((item, index) => {
      const title = normalizeQuery(typeof item === 'string' ? item : item?.title, 90);
      const body = normalizeQuery(typeof item === 'string' ? '' : item?.body, 320) || null;
      if (!title) return null;
      return { title, body, position: index };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function profileName(user) {
  return `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Участник';
}

function profileInitials(user) {
  return `${String(user?.firstName || '').charAt(0)}${String(user?.lastName || '').charAt(0)}`.toUpperCase() || 'FS';
}


async function notifyCommunityManagers(community, actorUserId, notification, db = prisma) {
  const communityId = Number(community?.id || 0);
  if (!communityId || !db?.communityMember) return;
  const managers = await db.communityMember.findMany({
    where: { communityId, status: 'active', role: { in: ['owner', 'admin', 'moderator'] } },
    select: { userId: true },
    take: 80,
  }).catch(() => []);
  const ids = [...new Set(managers.map((item) => Number(item.userId)).filter(Boolean))]
    .filter((id) => Number(id) !== Number(actorUserId));
  for (const userId of ids) {
    await createNotification({
      userId,
      actorUserId,
      type: notification.type || 'community_event',
      title: notification.title || 'Событие сообщества',
      body: notification.body || 'В сообществе появилось новое событие.',
      targetLabel: notification.targetLabel || community.name,
      entityType: 'community',
      entityId: community.id,
      payload: { slug: community.slug, ...(notification.payload || {}) },
    }, db);
  }
}

async function notifyCommunityUser(community, targetUserId, actorUserId, notification, db = prisma) {
  const userId = Number(targetUserId || 0);
  if (!userId || Number(userId) === Number(actorUserId)) return;
  await createNotification({
    userId,
    actorUserId,
    type: notification.type || 'community_event',
    title: notification.title || 'Событие сообщества',
    body: notification.body || 'В сообществе появилось новое событие.',
    targetLabel: notification.targetLabel || community?.name || 'Сообщество',
    entityType: 'community',
    entityId: community?.id,
    payload: { slug: community?.slug, ...(notification.payload || {}) },
  }, db);
}

function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: profileName(user),
    initials: profileInitials(user),
    handle: user.publicProfile?.handle || null,
    tone: user.publicProfile?.tone || 'violet',
    status: user.publicProfile?.status || 'recent',
  };
}

function serializeMember(member) {
  return {
    id: member.id,
    role: member.role,
    status: member.status || 'active',
    muted_until: member.mutedUntil?.toISOString?.() || null,
    muted_reason: member.mutedReason || '',
    banned_at: member.bannedAt?.toISOString?.() || null,
    ban_reason: member.banReason || '',
    joined_at: member.joinedAt?.toISOString?.() || null,
    user: serializeUser(member.user),
  };
}

function serializeJoinRequest(request) {
  return {
    id: request.id,
    status: request.status,
    message: request.message || '',
    created_at: request.createdAt?.toISOString?.() || null,
    reviewed_at: request.reviewedAt?.toISOString?.() || null,
    user: serializeUser(request.user),
    reviewed_by: serializeUser(request.reviewedByUser),
  };
}

function serializeInvite(invite) {
  return {
    id: invite.id,
    code: invite.code,
    usage_limit: invite.usageLimit,
    uses_count: invite.usesCount,
    expires_at: invite.expiresAt?.toISOString?.() || null,
    revoked_at: invite.revokedAt?.toISOString?.() || null,
    created_at: invite.createdAt?.toISOString?.() || null,
    target_user: serializeUser(invite.targetUser),
    created_by: serializeUser(invite.createdByUser),
  };
}

function serializeModerationAction(action) {
  return {
    id: action.id,
    action: action.action,
    reason: action.reason || '',
    metadata: action.metadata || {},
    created_at: action.createdAt?.toISOString?.() || null,
    actor: serializeUser(action.actorUser),
    target_user: serializeUser(action.targetUser),
  };
}

function serializeCommunityPostReport(report) {
  return {
    id: report.id,
    type: 'post',
    reason: report.reason,
    details: report.details || '',
    status: report.status,
    created_at: report.createdAt?.toISOString?.() || null,
    reporter: serializeUser(report.reporterUser),
    post: report.post ? {
      id: report.post.id,
      text: report.post.text,
      status: report.post.status || 'visible',
      author: serializeUser(report.post.author),
    } : null,
  };
}

function serializeCommunityCommentReport(report) {
  return {
    id: report.id,
    type: 'comment',
    reason: report.reason,
    details: report.details || '',
    status: report.status,
    created_at: report.createdAt?.toISOString?.() || null,
    reporter: serializeUser(report.reporterUser),
    comment: report.comment ? {
      id: report.comment.id,
      text: report.comment.text,
      status: report.comment.status || 'visible',
      author: serializeUser(report.comment.author),
      post_id: report.comment.postId,
    } : null,
  };
}

function serializeRule(rule) {
  return {
    id: rule.id,
    title: rule.title,
    body: rule.body || '',
    position: rule.position || 0,
  };
}

function getMembershipFromMap(community, membershipMap) {
  if (!membershipMap) return null;
  return membershipMap.get?.(community.id) || null;
}

export function serializeCommunity(community, membershipMap = new Map(), extra = {}) {
  const tags = Array.isArray(community?.tags) ? community.tags : [];
  const membership = extra.membership || getMembershipFromMap(community, membershipMap);
  const pendingRequest = extra.pendingRequest || null;
  const memberRole = membership?.role || null;
  const relation = membership
    ? 'member'
    : pendingRequest?.status === 'pending'
      ? 'requested'
      : 'none';

  return {
    id: community.id,
    slug: community.slug,
    name: community.name,
    description: community.description || '',
    city: community.city || null,
    visibility: community.visibility,
    is_official: Boolean(community.isOfficial),
    avatar_tone: community.avatarTone || 'violet',
    cover_tone: community.coverTone || community.avatarTone || 'violet',
    avatar_url: community.avatarUrl || null,
    cover_url: community.coverUrl || null,
    media_count: Number(community.mediaCount || 0),
    member_count: Number(community.memberCount || 0),
    rules_count: Number(community.rulesCount || 0),
    pending_request_count: Number(community.pendingRequestCount || 0),
    tags,
    settings: {
      posting_permission: community.postingPermission || 'members',
      commenting_permission: community.commentingPermission || 'members',
      member_list_visibility: community.memberListVisibility || 'members',
      discoverable: Boolean(community.discoverable),
      require_join_approval: Boolean(community.requireJoinApproval),
      allow_invites: Boolean(community.allowInvites),
    },
    owner: serializeUser(community.owner),
    last_activity_at: community.lastActivityAt?.toISOString?.() || null,
    created_at: community.createdAt?.toISOString?.() || null,
    relation,
    member_role: memberRole,
    can_manage: Boolean(memberRole && MANAGER_ROLES.has(memberRole)),
    can_admin: Boolean(memberRole && ADMIN_ROLES.has(memberRole)),
    can_post: canPostInCommunity(community, membership),
    join_request: pendingRequest ? serializeJoinRequest(pendingRequest) : null,
    members: Array.isArray(community.members) ? community.members.map(serializeMember) : undefined,
    rules: Array.isArray(community.rules) ? community.rules.map(serializeRule) : undefined,
    join_requests: Array.isArray(extra.joinRequests) ? extra.joinRequests.map(serializeJoinRequest) : undefined,
    invites: Array.isArray(extra.invites) ? extra.invites.map(serializeInvite) : undefined,
  };
}

function buildHaystack(community) {
  const tags = Array.isArray(community?.tags) ? community.tags.join(' ') : '';
  return [community?.name, community?.slug, community?.description, community?.city, tags]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function tokenize(value) {
  return normalizeQuery(value)
    .toLowerCase()
    .split(' ')
    .map((item) => item.trim())
    .filter(Boolean);
}

function rankCommunity(community, tokens) {
  if (!tokens.length) return 0;
  const haystack = buildHaystack(community);
  let score = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) return -1;
    score += 2;
    if (String(community.name || '').toLowerCase().startsWith(token)) score += 8;
    if (String(community.slug || '').toLowerCase().startsWith(token)) score += 10;
    if (String(community.city || '').toLowerCase().startsWith(token)) score += 2;
  }
  if (community.isOfficial) score += 3;
  score += Math.min(Number(community.memberCount || 0), 500) * 0.01;
  return score;
}

export async function listCommunitiesForUser(currentUserId, { query = '', scope = 'discover', limit = 24 } = {}, db = prisma) {
  const take = Math.max(1, Math.min(Number(limit) || 24, 80));
  const memberships = await db.communityMember.findMany({
    where: { userId: currentUserId, status: 'active' },
    select: { communityId: true, role: true, status: true },
  }).catch(() => []);
  const membershipMap = new Map(memberships.map((item) => [item.communityId, item]));
  const memberIds = memberships.map((item) => item.communityId);

  const where = scope === 'mine'
    ? { id: { in: memberIds.length ? memberIds : [0] } }
    : {
        OR: [
          { visibility: { in: ['public', 'closed'] }, discoverable: true },
          ...(memberIds.length ? [{ id: { in: memberIds } }] : []),
        ],
      };

  const rows = await db.community.findMany({
    where,
    include: { owner: { include: { publicProfile: true } } },
    orderBy: [{ isOfficial: 'desc' }, { lastActivityAt: 'desc' }, { updatedAt: 'desc' }],
    take: query ? 140 : take,
  }).catch(() => []);

  const tokens = tokenize(query);
  const visible = tokens.length
    ? rows
        .map((community) => ({ community, score: rankCommunity(community, tokens) }))
        .filter((item) => item.score >= 0)
        .sort((a, b) => b.score - a.score || String(a.community.name).localeCompare(String(b.community.name)))
        .slice(0, take)
        .map((item) => item.community)
    : rows;

  const pendingRequests = visible.length
    ? await db.communityJoinRequest.findMany({
        where: { userId: currentUserId, status: 'pending', communityId: { in: visible.map((item) => item.id) } },
      }).catch(() => [])
    : [];
  const pendingMap = new Map(pendingRequests.map((item) => [item.communityId, item]));

  return visible.map((community) => serializeCommunity(community, membershipMap, { pendingRequest: pendingMap.get(community.id) }));
}

export async function searchCommunities(currentUserId, rawQuery, { limit = 12 } = {}, db = prisma) {
  const query = normalizeQuery(rawQuery);
  if (!query) return { query, communities: [] };
  const communities = await listCommunitiesForUser(currentUserId, { query, limit }, db);
  return { query, communities: communities.map((community, index) => ({ ...community, search_score: Math.max(1, 100 - index) })) };
}

export async function listAdminCommunities({ status = 'all', limit = 40 } = {}, db = prisma) {
  const where = status === 'official' ? { isOfficial: true } : status === 'public' ? { visibility: 'public' } : {};
  const communities = await db.community.findMany({
    where,
    include: { owner: { include: { publicProfile: true } } },
    orderBy: [{ isOfficial: 'desc' }, { updatedAt: 'desc' }],
    take: Math.max(1, Math.min(Number(limit) || 40, 100)),
  });
  return communities.map((community) => serializeCommunity(community));
}

export async function getCommunityForUser(slug, currentUserId, db = prisma) {
  const normalizedSlug = normalizeCommunitySlug(slug);
  if (!normalizedSlug) return null;
  const community = await db.community.findUnique({
    where: { slug: normalizedSlug },
    include: {
      owner: { include: { publicProfile: true } },
      rules: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
      members: {
        where: { status: 'active' },
        include: { user: { include: { publicProfile: true } } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        take: 48,
      },
    },
  });
  if (!community) return null;

  const [membership, pendingRequest] = await Promise.all([
    db.communityMember.findUnique({ where: { communityId_userId: { communityId: community.id, userId: currentUserId } } }).catch(() => null),
    db.communityJoinRequest.findUnique({ where: { communityId_userId: { communityId: community.id, userId: currentUserId } } }).catch(() => null),
  ]);

  const canSeePrivate = Boolean(membership) || community.visibility !== 'private';
  if (!canSeePrivate) return null;

  if (!canViewCommunityMembers(community, membership)) {
    community.members = [];
  }

  return serializeCommunity(community, new Map(), { membership, pendingRequest });
}

async function makeUniqueSlug(baseSlug, db) {
  let slug = baseSlug;
  let counter = 1;
  while (await db.community.findUnique({ where: { slug } })) {
    counter += 1;
    const suffix = `-${counter}`;
    slug = `${baseSlug.slice(0, Math.max(1, 48 - suffix.length))}${suffix}`;
  }
  return slug;
}

function sanitizeCommunityInput(input = {}) {
  const name = normalizeQuery(input.name, 80);
  if (name.length < 2) throw httpError('Название сообщества слишком короткое.', 400, 'COMMUNITY_NAME_TOO_SHORT');

  const explicitSlug = normalizeCommunitySlug(input.slug || '');
  const baseSlug = explicitSlug || normalizeCommunitySlug(name);
  if (!baseSlug) throw httpError('Не удалось сформировать адрес сообщества.', 400, 'COMMUNITY_SLUG_INVALID');

  const visibility = normalizeVisibility(input.visibility);
  const description = normalizeQuery(input.description, 420) || null;
  const city = normalizeQuery(input.city, 80) || null;
  const requireJoinApproval = visibility !== 'public' ? true : Boolean(input.requireJoinApproval);

  return {
    name,
    baseSlug,
    description,
    city,
    visibility,
    isOfficial: Boolean(input.isOfficial),
    avatarTone: normalizeTone(input.avatarTone, 'violet'),
    coverTone: normalizeTone(input.coverTone, normalizeTone(input.avatarTone, 'violet')),
    tags: normalizeTags(input.tags),
    postingPermission: normalizePermission(input.postingPermission, 'members'),
    commentingPermission: normalizePermission(input.commentingPermission, 'members'),
    memberListVisibility: normalizePermission(input.memberListVisibility, 'members'),
    discoverable: visibility === 'private' ? false : input.discoverable !== false,
    requireJoinApproval,
    allowInvites: input.allowInvites !== false,
    rules: normalizeRules(input.rules),
  };
}

export async function createCommunity(input, db = prisma) {
  const data = sanitizeCommunityInput(input);
  const slug = await makeUniqueSlug(data.baseSlug, db);
  return db.community.create({
    data: {
      slug,
      name: data.name,
      description: data.description,
      city: data.city,
      visibility: data.visibility,
      isOfficial: data.isOfficial,
      avatarTone: data.avatarTone,
      coverTone: data.coverTone,
      tags: data.tags,
      memberCount: 0,
      rulesCount: data.rules.length,
      postingPermission: data.postingPermission,
      commentingPermission: data.commentingPermission,
      memberListVisibility: data.memberListVisibility,
      discoverable: data.discoverable,
      requireJoinApproval: data.requireJoinApproval,
      allowInvites: data.allowInvites,
      rules: data.rules.length ? { create: data.rules } : undefined,
    },
    include: { owner: { include: { publicProfile: true } }, rules: true },
  });
}

export async function createCommunityForUser(input, ownerUserId, db = prisma) {
  const data = sanitizeCommunityInput(input);
  const slug = await makeUniqueSlug(data.baseSlug, db);
  const community = await db.$transaction(async (tx) => {
    const created = await tx.community.create({
      data: {
        slug,
        name: data.name,
        description: data.description,
        city: data.city,
        visibility: data.visibility,
        isOfficial: false,
        avatarTone: data.avatarTone,
        coverTone: data.coverTone,
        tags: data.tags,
        ownerId: ownerUserId,
        memberCount: 1,
        rulesCount: data.rules.length,
        postingPermission: data.postingPermission,
        commentingPermission: data.commentingPermission,
        memberListVisibility: data.memberListVisibility,
        discoverable: data.discoverable,
        requireJoinApproval: data.requireJoinApproval,
        allowInvites: data.allowInvites,
        lastActivityAt: new Date(),
        members: { create: { userId: ownerUserId, role: 'owner' } },
        rules: data.rules.length ? { create: data.rules } : undefined,
      },
    });
    await tx.communityModerationAction.create({
      data: { communityId: created.id, actorUserId: ownerUserId, action: 'community.created', metadata: { visibility: created.visibility } },
    }).catch(() => null);
    return tx.community.findUnique({
      where: { id: created.id },
      include: { owner: { include: { publicProfile: true } }, rules: { orderBy: { position: 'asc' } } },
    });
  });
  return community;
}

export async function getCommunityMembership(communityId, userId, db = prisma) {
  if (!communityId || !userId) return null;
  return db.communityMember.findUnique({ where: { communityId_userId: { communityId, userId } } }).catch(() => null);
}

export function canManageCommunity(membership) {
  return Boolean(membership && membership.status === 'active' && MANAGER_ROLES.has(membership.role));
}

export function canAdminCommunity(membership) {
  return Boolean(membership && membership.status === 'active' && ADMIN_ROLES.has(membership.role));
}

function canViewCommunityMembers(community, membership) {
  const permission = String(community?.memberListVisibility || 'members');
  const role = membership?.role || null;
  if (permission === 'everyone') return community?.visibility !== 'private' || Boolean(membership);
  if (!membership || membership.status !== 'active') return false;
  if (role === 'owner') return true;
  if (permission === 'owner') return role === 'owner';
  if (permission === 'moderators') return MANAGER_ROLES.has(role);
  return ['owner', 'admin', 'moderator', 'member'].includes(role);
}

export async function joinOrRequestCommunity(slug, userId, input = {}, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');

  const existingMember = await db.communityMember.findUnique({ where: { communityId_userId: { communityId: community.id, userId } } }).catch(() => null);
  if (existingMember?.status === 'active') {
    return { status: 'member', community };
  }
  if (existingMember?.status === 'banned') {
    throw httpError('Доступ в это сообщество ограничен модерацией.', 403, 'COMMUNITY_MEMBER_BANNED');
  }

  const needsApproval = community.visibility !== 'public' || community.requireJoinApproval;
  if (needsApproval) {
    const message = normalizeQuery(input.message, 280) || null;
    const request = await db.$transaction(async (tx) => {
      const saved = await tx.communityJoinRequest.upsert({
        where: { communityId_userId: { communityId: community.id, userId } },
        update: { status: 'pending', message, reviewedAt: null, reviewedByUserId: null },
        create: { communityId: community.id, userId, message, status: 'pending' },
      });
      const pendingCount = await tx.communityJoinRequest.count({ where: { communityId: community.id, status: 'pending' } });
      await tx.community.update({ where: { id: community.id }, data: { pendingRequestCount: pendingCount } });
      return saved;
    });
    await notifyCommunityManagers(community, userId, {
      type: 'community_join_request',
      title: 'Новая заявка в сообщество',
      body: 'Пользователь хочет вступить в сообщество.',
      targetLabel: community.name,
      payload: { requestId: request.id, tab: 'requests' },
    }, db);
    return { status: 'requested', community, request };
  }

  const joined = await db.$transaction(async (tx) => {
    await tx.communityMember.upsert({
      where: { communityId_userId: { communityId: community.id, userId } },
      update: { status: 'active', role: 'member' },
      create: { communityId: community.id, userId, role: 'member', status: 'active' },
    });
    const memberCount = await tx.communityMember.count({ where: { communityId: community.id, status: 'active' } });
    const updated = await tx.community.update({ where: { id: community.id }, data: { memberCount, lastActivityAt: new Date() } });
    await tx.communityModerationAction.create({ data: { communityId: community.id, actorUserId: userId, action: 'member.joined' } }).catch(() => null);
    return updated;
  });

  await notifyCommunityManagers(joined, userId, {
    type: 'community_member_joined',
    title: 'Новый участник сообщества',
    body: 'Пользователь вступил в сообщество.',
    targetLabel: joined.name,
    payload: { tab: 'members' },
  }, db);

  return { status: 'member', community: joined };
}

export async function leaveCommunity(slug, userId, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');

  const member = await getCommunityMembership(community.id, userId, db);
  if (!member) return { status: 'none', community };
  if (member.role === 'owner') {
    const otherOwners = await db.communityMember.count({ where: { communityId: community.id, role: 'owner', userId: { not: userId }, status: 'active' } });
    if (otherOwners <= 0) throw httpError('Владелец не может выйти, пока не передаст сообщество другому владельцу.', 409, 'OWNER_TRANSFER_REQUIRED');
  }

  const updated = await db.$transaction(async (tx) => {
    await tx.communityMember.delete({ where: { communityId_userId: { communityId: community.id, userId } } }).catch(() => null);
    const memberCount = await tx.communityMember.count({ where: { communityId: community.id, status: 'active' } });
    await tx.communityModerationAction.create({ data: { communityId: community.id, actorUserId: userId, action: 'member.left' } }).catch(() => null);
    return tx.community.update({ where: { id: community.id }, data: { memberCount, lastActivityAt: new Date() } });
  });

  return { status: 'left', community: updated };
}

export async function listJoinRequests(slug, actorUserId, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');
  const membership = await getCommunityMembership(community.id, actorUserId, db);
  if (!canManageCommunity(membership)) throw httpError('Нет прав на просмотр заявок.', 403, 'COMMUNITY_FORBIDDEN');

  return db.communityJoinRequest.findMany({
    where: { communityId: community.id, status: 'pending' },
    include: { user: { include: { publicProfile: true } }, reviewedByUser: { include: { publicProfile: true } } },
    orderBy: { createdAt: 'asc' },
    take: 80,
  });
}

export async function reviewJoinRequest(slug, requestId, actorUserId, decision, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');
  const actorMembership = await getCommunityMembership(community.id, actorUserId, db);
  if (!canManageCommunity(actorMembership)) throw httpError('Нет прав на обработку заявок.', 403, 'COMMUNITY_FORBIDDEN');

  const normalizedDecision = String(decision || '').toLowerCase();
  if (!['approve', 'approved', 'decline', 'declined'].includes(normalizedDecision)) {
    throw httpError('Неизвестное решение по заявке.', 400, 'JOIN_REQUEST_DECISION_INVALID');
  }
  const approve = normalizedDecision.startsWith('approve');

  const updatedRequest = await db.$transaction(async (tx) => {
    const request = await tx.communityJoinRequest.findUnique({ where: { id: Number(requestId) } });
    if (!request || request.communityId !== community.id) throw httpError('Заявка не найдена.', 404, 'JOIN_REQUEST_NOT_FOUND');
    if (request.status !== 'pending') throw httpError('Заявка уже обработана.', 409, 'JOIN_REQUEST_ALREADY_REVIEWED');

    const updatedRequest = await tx.communityJoinRequest.update({
      where: { id: request.id },
      data: { status: approve ? 'approved' : 'declined', reviewedByUserId: actorUserId, reviewedAt: new Date() },
      include: { user: { include: { publicProfile: true } }, reviewedByUser: { include: { publicProfile: true } } },
    });

    if (approve) {
      const existingTargetMember = await tx.communityMember.findUnique({ where: { communityId_userId: { communityId: community.id, userId: request.userId } } });
      if (existingTargetMember?.status === 'banned') throw httpError('Пользователь заблокирован в сообществе.', 409, 'COMMUNITY_MEMBER_BANNED');
      await tx.communityMember.upsert({
        where: { communityId_userId: { communityId: community.id, userId: request.userId } },
        update: { status: 'active', role: 'member', mutedUntil: null, mutedReason: null, bannedAt: null, banReason: null },
        create: { communityId: community.id, userId: request.userId, role: 'member', status: 'active' },
      });
    }

    const [memberCount, pendingCount] = await Promise.all([
      tx.communityMember.count({ where: { communityId: community.id, status: 'active' } }),
      tx.communityJoinRequest.count({ where: { communityId: community.id, status: 'pending' } }),
    ]);
    await tx.community.update({ where: { id: community.id }, data: { memberCount, pendingRequestCount: pendingCount, lastActivityAt: new Date() } });
    await tx.communityModerationAction.create({
      data: {
        communityId: community.id,
        actorUserId,
        targetUserId: request.userId,
        action: approve ? 'join_request.approved' : 'join_request.declined',
        metadata: { request_id: request.id },
      },
    }).catch(() => null);

    return updatedRequest;
  });

  await notifyCommunityUser(community, updatedRequest.userId, actorUserId, {
    type: approve ? 'community_join_request_approved' : 'community_join_request_declined',
    title: approve ? 'Заявка в сообщество принята' : 'Заявка в сообщество отклонена',
    body: approve ? 'Теперь вы участник сообщества.' : 'Модератор отклонил заявку на вступление.',
    targetLabel: community.name,
    payload: { requestId: updatedRequest.id },
  }, db);

  return updatedRequest;
}

function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i += 1) suffix += alphabet[bytes[i] % alphabet.length];
  return `FSC-${suffix.slice(0, 4)}-${suffix.slice(4)}`;
}

export async function listCommunityInvites(slug, actorUserId, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');
  const membership = await getCommunityMembership(community.id, actorUserId, db);
  if (!canManageCommunity(membership)) throw httpError('Нет прав на просмотр приглашений.', 403, 'COMMUNITY_FORBIDDEN');
  return db.communityInvite.findMany({
    where: { communityId: community.id },
    include: { createdByUser: { include: { publicProfile: true } }, targetUser: { include: { publicProfile: true } } },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });
}

export async function createCommunityInvite(slug, actorUserId, input = {}, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');
  if (!community.allowInvites) throw httpError('Приглашения в этом сообществе отключены.', 403, 'COMMUNITY_INVITES_DISABLED');

  const membership = await getCommunityMembership(community.id, actorUserId, db);
  const memberCanInvite = Boolean(membership) && (canManageCommunity(membership) || community.visibility !== 'private');
  if (!memberCanInvite) throw httpError('Нет прав на создание приглашений.', 403, 'COMMUNITY_FORBIDDEN');

  const usageLimit = Math.max(1, Math.min(Number(input.usageLimit || 1) || 1, 100));
  const expiresInDays = Math.max(1, Math.min(Number(input.expiresInDays || 14) || 14, 90));
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  let code = generateInviteCode();
  while (await db.communityInvite.findUnique({ where: { code } }).catch(() => null)) code = generateInviteCode();

  return db.communityInvite.create({
    data: { communityId: community.id, createdByUserId: actorUserId, code, usageLimit, expiresAt },
    include: { createdByUser: { include: { publicProfile: true } }, targetUser: { include: { publicProfile: true } } },
  });
}


function normalizeCommunityAssetUrl(value, communityId) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!isCommunityUploadUrl(raw, communityId)) throw httpError('Медиа сообщества должно быть загружено через раздел сообщества.', 400, 'COMMUNITY_MEDIA_URL_INVALID');
  return raw.slice(0, 420);
}

function normalizeCommunityMediaItems(input = [], communityId) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const url = sanitizeClientMediaUrl(item.url);
      if (!url || seen.has(url) || !isCommunityUploadUrl(url, communityId)) return null;
      seen.add(url);
      const kind = String(item.kind || '').trim().toLowerCase() === 'video' ? 'video' : 'image';
      return {
        kind,
        url,
        thumbUrl: sanitizeClientMediaUrl(item.thumbUrl || item.thumb_url) || (kind === 'image' ? url : null),
        storage: String(item.storage || '').trim().slice(0, 40) || null,
        storageKey: String(item.storageKey || item.storage_key || '').trim().slice(0, 500) || null,
        previewStorageKey: String(item.previewStorageKey || item.preview_storage_key || '').trim().slice(0, 500) || null,
        previewBytes: Number(item.previewBytes || item.preview_bytes || 0) || 0,
        previewMime: String(item.previewMime || item.preview_mime || '').trim().slice(0, 80) || null,
        previewGenerated: Boolean(item.previewGenerated || item.preview_generated),
        private: Boolean(item.private),
        mime: String(item.mime || '').trim().slice(0, 80) || null,
        bytes: Number(item.bytes || item.size || 0) || 0,
        originalBytes: Number(item.originalBytes || item.original_bytes || item.bytes || 0) || 0,
        exifStripped: Boolean(item.exifStripped || item.exif_stripped),
        width: Number(item.width || 0) || null,
        height: Number(item.height || 0) || null,
        durationSec: Number(item.durationSec || item.duration_sec || 0) || null,
        originalName: String(item.originalName || item.original_name || '').trim().slice(0, 160) || null,
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function flattenCommunityPostMedia(posts = []) {
  const items = [];
  for (const post of posts) {
    const payload = post?.payload && typeof post.payload === 'object' ? post.payload : {};
    const media = Array.isArray(payload.media) ? payload.media : [];
    for (const item of media) {
      if (!item?.url) continue;
      items.push({
        ...item,
        post_id: post.id,
        post_text: post.text || '',
        created_at: post.createdAt?.toISOString?.() || post.createdAt || null,
        author: serializeUser(post.author),
      });
    }
  }
  return items;
}

function sanitizeCommunityUpdateInput(input = {}, current = {}) {
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(input, 'name')) {
    const name = normalizeQuery(input.name, 80);
    if (name.length < 2) throw httpError('Название сообщества слишком короткое.', 400, 'COMMUNITY_NAME_TOO_SHORT');
    patch.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'description')) patch.description = normalizeQuery(input.description, 420) || null;
  if (Object.prototype.hasOwnProperty.call(input, 'city')) patch.city = normalizeQuery(input.city, 80) || null;
  if (Object.prototype.hasOwnProperty.call(input, 'visibility')) patch.visibility = normalizeVisibility(input.visibility);
  if (Object.prototype.hasOwnProperty.call(input, 'avatarTone')) patch.avatarTone = normalizeTone(input.avatarTone, current.avatarTone || 'violet');
  if (Object.prototype.hasOwnProperty.call(input, 'coverTone')) patch.coverTone = normalizeTone(input.coverTone, current.coverTone || current.avatarTone || 'violet');
  if (Object.prototype.hasOwnProperty.call(input, 'avatarUrl')) patch.avatarUrl = normalizeCommunityAssetUrl(input.avatarUrl, current.id);
  if (Object.prototype.hasOwnProperty.call(input, 'coverUrl')) patch.coverUrl = normalizeCommunityAssetUrl(input.coverUrl, current.id);
  if (Object.prototype.hasOwnProperty.call(input, 'tags')) patch.tags = normalizeTags(input.tags);
  if (Object.prototype.hasOwnProperty.call(input, 'postingPermission')) patch.postingPermission = normalizePermission(input.postingPermission, current.postingPermission || 'members');
  if (Object.prototype.hasOwnProperty.call(input, 'commentingPermission')) patch.commentingPermission = normalizePermission(input.commentingPermission, current.commentingPermission || 'members');
  if (Object.prototype.hasOwnProperty.call(input, 'memberListVisibility')) patch.memberListVisibility = normalizePermission(input.memberListVisibility, current.memberListVisibility || 'members');
  if (Object.prototype.hasOwnProperty.call(input, 'discoverable')) patch.discoverable = Boolean(input.discoverable);
  if (Object.prototype.hasOwnProperty.call(input, 'requireJoinApproval')) patch.requireJoinApproval = Boolean(input.requireJoinApproval);
  if (Object.prototype.hasOwnProperty.call(input, 'allowInvites')) patch.allowInvites = Boolean(input.allowInvites);

  if (patch.visibility === 'private') patch.discoverable = false;
  if (patch.visibility && patch.visibility !== 'public') patch.requireJoinApproval = true;

  return {
    patch,
    rules: Object.prototype.hasOwnProperty.call(input, 'rules') ? normalizeRules(input.rules) : null,
  };
}

export async function updateCommunitySettings(slug, actorUserId, input = {}, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');

  const membership = await getCommunityMembership(community.id, actorUserId, db);
  if (!canAdminCommunity(membership)) throw httpError('Настройки могут менять только владелец или администратор.', 403, 'COMMUNITY_FORBIDDEN');

  const { patch, rules } = sanitizeCommunityUpdateInput(input, community);
  return db.$transaction(async (tx) => {
    if (rules) {
      await tx.communityRule.deleteMany({ where: { communityId: community.id } });
      if (rules.length) {
        await tx.communityRule.createMany({ data: rules.map((rule) => ({ ...rule, communityId: community.id })) });
      }
      patch.rulesCount = rules.length;
    }

    const updated = await tx.community.update({
      where: { id: community.id },
      data: patch,
      include: {
        owner: { include: { publicProfile: true } },
        rules: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
        members: {
          where: { status: 'active' },
          include: { user: { include: { publicProfile: true } } },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
          take: 80,
        },
      },
    });
    await tx.communityModerationAction.create({
      data: {
        communityId: community.id,
        actorUserId,
        action: 'community.settings.updated',
        metadata: { changed: Object.keys(patch), rules_changed: Boolean(rules) },
      },
    }).catch(() => null);
    return updated;
  });
}

function canChangeTargetRole(actorRole, targetRole, nextRole) {
  if (actorRole === 'owner') return targetRole !== 'owner' && ['admin', 'moderator', 'member'].includes(nextRole);
  if (actorRole === 'admin') return !['owner', 'admin'].includes(targetRole) && ['moderator', 'member'].includes(nextRole);
  return false;
}

export async function updateCommunityMemberRole(slug, memberId, actorUserId, nextRole, db = prisma) {
  const normalizedRole = String(nextRole || '').trim().toLowerCase();
  if (!['admin', 'moderator', 'member'].includes(normalizedRole)) throw httpError('Неверная роль участника.', 400, 'COMMUNITY_ROLE_INVALID');

  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');

  const [actorMembership, target] = await Promise.all([
    getCommunityMembership(community.id, actorUserId, db),
    db.communityMember.findUnique({ where: { id: Number(memberId) }, include: { user: { include: { publicProfile: true } } } }).catch(() => null),
  ]);
  if (!target || target.communityId !== community.id || target.status !== 'active') throw httpError('Участник не найден.', 404, 'COMMUNITY_MEMBER_NOT_FOUND');
  if (!canAdminCommunity(actorMembership)) throw httpError('Нет прав на изменение ролей.', 403, 'COMMUNITY_FORBIDDEN');
  if (target.userId === actorUserId) throw httpError('Нельзя менять собственную роль.', 409, 'COMMUNITY_SELF_ROLE_FORBIDDEN');
  if (!canChangeTargetRole(actorMembership.role, target.role, normalizedRole)) throw httpError('Недостаточно прав для этой роли.', 403, 'COMMUNITY_ROLE_FORBIDDEN');

  return db.$transaction(async (tx) => {
    const updated = await tx.communityMember.update({
      where: { id: target.id },
      data: { role: normalizedRole },
      include: { user: { include: { publicProfile: true } } },
    });
    await tx.communityModerationAction.create({
      data: {
        communityId: community.id,
        actorUserId,
        targetUserId: target.userId,
        action: 'member.role.updated',
        metadata: { from: target.role, to: normalizedRole },
      },
    }).catch(() => null);
    return updated;
  });
}

function canModerateTargetMember(actorRole, targetRole) {
  if (actorRole === 'owner') return targetRole !== 'owner';
  if (actorRole === 'admin') return !['owner', 'admin'].includes(targetRole);
  if (actorRole === 'moderator') return targetRole === 'member';
  return false;
}

export async function moderateCommunityMember(slug, memberId, actorUserId, action, input = {}, db = prisma) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!COMMUNITY_MEMBER_ACTIONS.has(normalizedAction)) throw httpError('Неверное действие модерации.', 400, 'COMMUNITY_MEMBER_ACTION_INVALID');

  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');

  const [actorMembership, target] = await Promise.all([
    getCommunityMembership(community.id, actorUserId, db),
    db.communityMember.findUnique({ where: { id: Number(memberId) }, include: { user: { include: { publicProfile: true } } } }).catch(() => null),
  ]);
  if (!canManageCommunity(actorMembership)) throw httpError('Нет прав на модерацию участников.', 403, 'COMMUNITY_FORBIDDEN');
  if (!target || target.communityId !== community.id) throw httpError('Участник не найден.', 404, 'COMMUNITY_MEMBER_NOT_FOUND');
  if (target.userId === actorUserId) throw httpError('Нельзя модерировать самого себя.', 409, 'COMMUNITY_SELF_MODERATION_FORBIDDEN');
  if (!canModerateTargetMember(actorMembership.role, target.role)) throw httpError('Недостаточно прав для модерации этого участника.', 403, 'COMMUNITY_MEMBER_MODERATION_FORBIDDEN');

  const reason = normalizeQuery(input.reason, 240) || null;
  const muteHours = Math.max(1, Math.min(Number(input.hours || 24) || 24, 24 * 30));
  const now = new Date();
  const dataByAction = {
    mute: { status: target.status === 'banned' ? 'banned' : 'active', mutedUntil: new Date(now.getTime() + muteHours * 60 * 60 * 1000), mutedReason: reason },
    unmute: { mutedUntil: null, mutedReason: null },
    ban: { status: 'banned', mutedUntil: null, mutedReason: null, bannedAt: now, banReason: reason, role: 'member' },
    unban: { status: 'active', bannedAt: null, banReason: null, mutedUntil: null, mutedReason: null, role: 'member' },
  };

  return db.$transaction(async (tx) => {
    const updated = await tx.communityMember.update({
      where: { id: target.id },
      data: dataByAction[normalizedAction],
      include: { user: { include: { publicProfile: true } } },
    });
    const memberCount = await tx.communityMember.count({ where: { communityId: community.id, status: 'active' } });
    await tx.community.update({ where: { id: community.id }, data: { memberCount, lastActivityAt: new Date() } });
    await tx.communityModerationAction.create({
      data: {
        communityId: community.id,
        actorUserId,
        targetUserId: target.userId,
        action: `member.${normalizedAction}`,
        reason,
        metadata: normalizedAction === 'mute' ? { hours: muteHours, until: dataByAction.mute.mutedUntil.toISOString() } : {},
      },
    }).catch(() => null);
    return updated;
  });
}

export async function removeCommunityMember(slug, memberId, actorUserId, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');

  const [actorMembership, target] = await Promise.all([
    getCommunityMembership(community.id, actorUserId, db),
    db.communityMember.findUnique({ where: { id: Number(memberId) }, include: { user: { include: { publicProfile: true } } } }).catch(() => null),
  ]);
  if (!target || target.communityId !== community.id || target.status !== 'active') throw httpError('Участник не найден.', 404, 'COMMUNITY_MEMBER_NOT_FOUND');
  if (!canAdminCommunity(actorMembership)) throw httpError('Нет прав на удаление участника.', 403, 'COMMUNITY_FORBIDDEN');
  if (target.role === 'owner') throw httpError('Нельзя удалить владельца сообщества.', 409, 'COMMUNITY_OWNER_REMOVE_FORBIDDEN');
  if (target.userId === actorUserId) throw httpError('Нельзя удалить самого себя через управление участниками.', 409, 'COMMUNITY_SELF_REMOVE_FORBIDDEN');
  if (actorMembership.role === 'admin' && target.role === 'admin') throw httpError('Администратор не может удалить другого администратора.', 403, 'COMMUNITY_ADMIN_REMOVE_FORBIDDEN');

  return db.$transaction(async (tx) => {
    await tx.communityMember.delete({ where: { id: target.id } });
    const memberCount = await tx.communityMember.count({ where: { communityId: community.id, status: 'active' } });
    const updatedCommunity = await tx.community.update({ where: { id: community.id }, data: { memberCount, lastActivityAt: new Date() } });
    await tx.communityModerationAction.create({
      data: { communityId: community.id, actorUserId, targetUserId: target.userId, action: 'member.removed' },
    }).catch(() => null);
    return { member: target, community: updatedCommunity };
  });
}

export async function listCommunityModerationActions(slug, actorUserId, { limit = 30 } = {}, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');
  const membership = await getCommunityMembership(community.id, actorUserId, db);
  if (!canManageCommunity(membership)) throw httpError('Нет прав на журнал действий.', 403, 'COMMUNITY_FORBIDDEN');

  const actions = await db.communityModerationAction.findMany({
    where: { communityId: community.id },
    include: { actorUser: { include: { publicProfile: true } }, targetUser: { include: { publicProfile: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(Number(limit) || 30, 80)),
  });
  return actions.map(serializeModerationAction);
}

function isMembershipMuted(membership) {
  if (!membership?.mutedUntil) return false;
  return new Date(membership.mutedUntil).getTime() > Date.now();
}

export function canPostInCommunity(community, membership) {
  const permission = String(community?.postingPermission || 'members');
  const role = membership?.role || null;
  if (isMembershipMuted(membership)) return false;
  if (permission === 'everyone') return community?.visibility === 'public' || Boolean(membership);
  if (!role || membership?.status !== 'active') return false;
  if (role === 'owner') return true;
  if (permission === 'owner') return role === 'owner';
  if (permission === 'moderators') return POST_MANAGER_ROLES.has(role);
  if (permission === 'verified') return ['owner', 'admin', 'moderator', 'member'].includes(role);
  return ['owner', 'admin', 'moderator', 'member'].includes(role);
}

export function canViewCommunityPosts(community, membership) {
  if (!community) return false;
  if (community.visibility === 'public') return true;
  return Boolean(membership && membership.status === 'active');
}

export async function listCommunityPosts(slug, currentUserId, { limit = PERF_LIMITS.communityPosts.default, cursor = '' } = {}, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');

  const membership = await getCommunityMembership(community.id, currentUserId, db);
  if (!canViewCommunityPosts(community, membership)) {
    throw httpError('Посты доступны только участникам сообщества.', 403, 'COMMUNITY_POSTS_FORBIDDEN');
  }

  const canManagePosts = canManageCommunity(membership);
  const safeLimit = parsePositiveInt(limit, PERF_LIMITS.communityPosts.default, PERF_LIMITS.communityPosts.max);
  const rows = await db.post.findMany({
    where: {
      communityId: community.id,
      ...buildCreatedBeforeWhere(cursor),
      ...(canManagePosts ? { status: { not: 'deleted' } } : { status: 'visible' }),
    },
    include: buildPostListInclude(currentUserId),
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    take: safeLimit + 1,
  });
  const posts = rows.slice(0, safeLimit);

  return {
    posts: await serializePostsForViewer(posts, currentUserId, db),
    page: {
      limit: safeLimit,
      has_more: rows.length > safeLimit,
      next_cursor: rows.length > safeLimit ? getNextCreatedAtCursor(posts, safeLimit) : null,
    },
  };
}

export async function createCommunityPost(slug, currentUserId, input = {}, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');

  const membership = await getCommunityMembership(community.id, currentUserId, db);
  if (!canPostInCommunity(community, membership)) {
    if (isMembershipMuted(membership)) throw httpError('Вы временно не можете публиковать в этом сообществе.', 403, 'COMMUNITY_MEMBER_MUTED');
    throw httpError('Нет прав на публикацию в этом сообществе.', 403, 'COMMUNITY_POST_FORBIDDEN');
  }

  const text = normalizePostText(input.text, 1600);
  const media = normalizeCommunityMediaItems(input.media, community.id);
  await assertMediaReferencesBelongToScope({
    db,
    media,
    ownerUserId: currentUserId,
    allowedSurfaces: ['community'],
    allowedScopeIds: [community.id],
    label: 'медиа сообщества',
  });
  if (!text && !media.length) throw httpError('Добавьте текст или медиа для поста.', 400, 'COMMUNITY_POST_EMPTY');

  const location = normalizeQuery(input.location, 120) || null;
  const created = await db.$transaction(async (tx) => {
    const post = await tx.post.create({
      data: {
        authorId: currentUserId,
        communityId: community.id,
        text: text || '',
        type: media.length ? 'media' : 'text',
        visibility: community.visibility === 'public' ? 'public' : 'community',
        location,
        payload: {
          source: 'community',
          surface: 'community',
          communitySlug: community.slug,
          communityName: community.name,
          aggregatedIntoFeed: community.visibility === 'public',
          media,
        },
      },
      include: communityPostInclude,
    });
    await tx.community.update({
      where: { id: community.id },
      data: {
        lastActivityAt: new Date(),
        ...(media.length ? { mediaCount: { increment: media.length } } : {}),
      },
    });
    await tx.communityModerationAction.create({
      data: {
        communityId: community.id,
        actorUserId: currentUserId,
        action: 'post.created',
        metadata: { post_id: post.id },
      },
    }).catch(() => null);
    return post;
  });

  return serializePostForViewer(created, currentUserId, db);
}


export async function listCommunityMedia(slug, currentUserId, { limit = PERF_LIMITS.mediaItems.default, cursor = '' } = {}, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');

  const membership = await getCommunityMembership(community.id, currentUserId, db);
  if (!canViewCommunityPosts(community, membership)) {
    throw httpError('Медиа доступны только участникам сообщества.', 403, 'COMMUNITY_MEDIA_FORBIDDEN');
  }

  const canManagePosts = canManageCommunity(membership);
  const safeLimit = parsePositiveInt(limit, PERF_LIMITS.mediaItems.default, PERF_LIMITS.mediaItems.max);
  const rows = await db.post.findMany({
    where: {
      communityId: community.id,
      type: 'media',
      ...buildCreatedBeforeWhere(cursor),
      ...(canManagePosts ? { status: { not: 'deleted' } } : { status: 'visible' }),
    },
    select: {
      id: true,
      authorId: true,
      text: true,
      type: true,
      payload: true,
      createdAt: true,
      author: { include: { publicProfile: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: safeLimit + 1,
  });
  const posts = rows.slice(0, safeLimit);

  return {
    media: flattenCommunityPostMedia(posts),
    page: {
      limit: safeLimit,
      has_more: rows.length > safeLimit,
      next_cursor: rows.length > safeLimit ? getNextCreatedAtCursor(posts, safeLimit) : null,
    },
  };
}


export async function moderateCommunityPost(slug, postId, actorUserId, action, input = {}, db = prisma) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!COMMUNITY_POST_ACTIONS.has(normalizedAction)) throw httpError('Неверное действие с постом.', 400, 'COMMUNITY_POST_ACTION_INVALID');

  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');

  const membership = await getCommunityMembership(community.id, actorUserId, db);
  if (!canManageCommunity(membership)) throw httpError('Нет прав на модерацию постов.', 403, 'COMMUNITY_FORBIDDEN');

  const targetPostId = Number(postId);
  const post = await db.post.findUnique({ where: { id: targetPostId }, include: communityPostInclude }).catch(() => null);
  if (!post || post.communityId !== community.id) throw httpError('Пост сообщества не найден.', 404, 'COMMUNITY_POST_NOT_FOUND');

  const reason = normalizeQuery(input.reason, 240) || null;
  const patchByAction = {
    hide: { status: 'hidden', moderationReason: reason || 'community_moderation', hiddenAt: new Date() },
    restore: { status: 'visible', moderationReason: null, hiddenAt: null, deletedAt: null },
    delete: { status: 'deleted', moderationReason: reason || 'community_moderation', deletedAt: new Date(), isPinned: false },
    pin: { isPinned: true },
    unpin: { isPinned: false },
  };

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.post.update({ where: { id: post.id }, data: patchByAction[normalizedAction], include: communityPostInclude });
    if (['hide', 'delete'].includes(normalizedAction)) {
      await tx.postReport.updateMany({ where: { postId: post.id, status: 'new' }, data: { status: 'actioned' } }).catch(() => null);
    }
    if (normalizedAction === 'restore') {
      await tx.postReport.updateMany({ where: { postId: post.id, status: 'new' }, data: { status: 'reviewed' } }).catch(() => null);
    }
    await tx.communityModerationAction.create({
      data: {
        communityId: community.id,
        actorUserId,
        targetUserId: post.authorId,
        action: `post.${normalizedAction}`,
        reason,
        metadata: { post_id: post.id },
      },
    }).catch(() => null);
    await tx.community.update({ where: { id: community.id }, data: { lastActivityAt: new Date() } }).catch(() => null);
    return saved;
  });

  if (['hide', 'restore', 'delete'].includes(normalizedAction)) {
    const titles = { hide: 'Пост скрыт модератором', restore: 'Пост восстановлен', delete: 'Пост удалён модератором' };
    const bodies = { hide: 'Модератор скрыл ваш пост в сообществе.', restore: 'Модератор восстановил ваш пост в сообществе.', delete: 'Модератор удалил ваш пост из сообщества.' };
    await notifyCommunityUser(community, post.authorId, actorUserId, {
      type: `community_post_${normalizedAction}`,
      title: titles[normalizedAction],
      body: bodies[normalizedAction],
      targetLabel: community.name,
      payload: { postId: post.id, tab: 'feed' },
    }, db);
  }

  return serializePostForViewer(updated, actorUserId, db);
}

export async function moderateCommunityComment(slug, commentId, actorUserId, action, input = {}, db = prisma) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!COMMUNITY_COMMENT_ACTIONS.has(normalizedAction)) throw httpError('Неверное действие с комментарием.', 400, 'COMMUNITY_COMMENT_ACTION_INVALID');

  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');

  const membership = await getCommunityMembership(community.id, actorUserId, db);
  if (!canManageCommunity(membership)) throw httpError('Нет прав на модерацию комментариев.', 403, 'COMMUNITY_FORBIDDEN');

  const targetCommentId = Number(commentId);
  const comment = await db.comment.findUnique({
    where: { id: targetCommentId },
    include: { author: { include: { publicProfile: true } }, post: true },
  }).catch(() => null);
  if (!comment || comment.post?.communityId !== community.id) throw httpError('Комментарий сообщества не найден.', 404, 'COMMUNITY_COMMENT_NOT_FOUND');

  const reason = normalizeQuery(input.reason, 240) || null;
  const patchByAction = {
    hide: { status: 'hidden', moderationReason: reason || 'community_moderation', hiddenAt: new Date() },
    restore: { status: 'visible', moderationReason: null, hiddenAt: null, deletedAt: null },
    delete: { status: 'deleted', moderationReason: reason || 'community_moderation', deletedAt: new Date() },
  };

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.comment.update({
      where: { id: comment.id },
      data: patchByAction[normalizedAction],
      include: { author: { include: { publicProfile: true } } },
    });
    if (['hide', 'delete'].includes(normalizedAction)) {
      await tx.commentReport.updateMany({ where: { commentId: comment.id, status: 'new' }, data: { status: 'actioned' } }).catch(() => null);
    }
    if (normalizedAction === 'restore') {
      await tx.commentReport.updateMany({ where: { commentId: comment.id, status: 'new' }, data: { status: 'reviewed' } }).catch(() => null);
    }
    await tx.communityModerationAction.create({
      data: {
        communityId: community.id,
        actorUserId,
        targetUserId: comment.authorId,
        action: `comment.${normalizedAction}`,
        reason,
        metadata: { comment_id: comment.id, post_id: comment.postId },
      },
    }).catch(() => null);
    return saved;
  });

  if (['hide', 'restore', 'delete'].includes(normalizedAction)) {
    const titles = { hide: 'Комментарий скрыт модератором', restore: 'Комментарий восстановлен', delete: 'Комментарий удалён модератором' };
    const bodies = { hide: 'Модератор скрыл ваш комментарий в сообществе.', restore: 'Модератор восстановил ваш комментарий в сообществе.', delete: 'Модератор удалил ваш комментарий из сообщества.' };
    await notifyCommunityUser(community, comment.authorId, actorUserId, {
      type: `community_comment_${normalizedAction}`,
      title: titles[normalizedAction],
      body: bodies[normalizedAction],
      targetLabel: community.name,
      payload: { postId: comment.postId, commentId: comment.id, tab: 'moderation' },
    }, db);
  }

  return updated;
}

export async function listCommunityModerationQueue(slug, actorUserId, { limit = 30 } = {}, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');

  const membership = await getCommunityMembership(community.id, actorUserId, db);
  if (!canManageCommunity(membership)) throw httpError('Нет прав на очередь модерации.', 403, 'COMMUNITY_FORBIDDEN');

  const take = Math.max(1, Math.min(Number(limit) || 30, 80));
  const [postReports, commentReports] = await Promise.all([
    db.postReport.findMany({
      where: { status: 'new', post: { communityId: community.id } },
      include: {
        reporterUser: { include: { publicProfile: true } },
        post: { include: { author: { include: { publicProfile: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    }).catch(() => []),
    db.commentReport.findMany({
      where: { status: 'new', comment: { post: { communityId: community.id } } },
      include: {
        reporterUser: { include: { publicProfile: true } },
        comment: { include: { author: { include: { publicProfile: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    }).catch(() => []),
  ]);

  return [...postReports.map(serializeCommunityPostReport), ...commentReports.map(serializeCommunityCommentReport)]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, take);
}


function inviteIsUsable(invite, currentUserId) {
  if (!invite) return { ok: false, reason: 'Код приглашения не найден.' };
  if (invite.revokedAt) return { ok: false, reason: 'Код приглашения отозван.' };
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) return { ok: false, reason: 'Срок действия кода истёк.' };
  if (Number(invite.usesCount || 0) >= Number(invite.usageLimit || 1)) return { ok: false, reason: 'Лимит использований кода исчерпан.' };
  if (invite.targetUserId && Number(invite.targetUserId) !== Number(currentUserId)) return { ok: false, reason: 'Этот код создан для другого пользователя.' };
  return { ok: true, reason: '' };
}

export async function getCommunityInvitePreview(rawCode, currentUserId, db = prisma) {
  const code = normalizeQuery(rawCode, 40).toUpperCase();
  if (!code) throw httpError('Введите invite-код.', 400, 'COMMUNITY_INVITE_CODE_REQUIRED');
  const invite = await db.communityInvite.findUnique({
    where: { code },
    include: {
      community: { include: { owner: { include: { publicProfile: true } } } },
      createdByUser: { include: { publicProfile: true } },
      targetUser: { include: { publicProfile: true } },
    },
  }).catch(() => null);
  if (!invite || !invite.community) throw httpError('Invite-код не найден.', 404, 'COMMUNITY_INVITE_NOT_FOUND');

  const membership = await getCommunityMembership(invite.communityId, currentUserId, db);
  const usability = inviteIsUsable(invite, currentUserId);
  const pendingRequest = await db.communityJoinRequest.findUnique({
    where: { communityId_userId: { communityId: invite.communityId, userId: currentUserId } },
  }).catch(() => null);

  return {
    invite: serializeInvite(invite),
    community: serializeCommunity(invite.community, new Map(), { membership, pendingRequest }),
    can_accept: usability.ok && membership?.status !== 'active' && membership?.status !== 'banned',
    already_member: membership?.status === 'active',
    blocked: membership?.status === 'banned',
    reason: membership?.status === 'active' ? 'Вы уже участник этого сообщества.' : membership?.status === 'banned' ? 'Доступ ограничен модерацией.' : usability.reason,
  };
}

export async function acceptCommunityInvite(rawCode, currentUserId, db = prisma) {
  const code = normalizeQuery(rawCode, 40).toUpperCase();
  if (!code) throw httpError('Введите invite-код.', 400, 'COMMUNITY_INVITE_CODE_REQUIRED');

  return db.$transaction(async (tx) => {
    const invite = await tx.communityInvite.findUnique({
      where: { code },
      include: { community: { include: { owner: { include: { publicProfile: true } } } } },
    });
    if (!invite || !invite.community) throw httpError('Invite-код не найден.', 404, 'COMMUNITY_INVITE_NOT_FOUND');

    const usability = inviteIsUsable(invite, currentUserId);
    if (!usability.ok) throw httpError(usability.reason, 409, 'COMMUNITY_INVITE_NOT_USABLE');

    const existingMember = await tx.communityMember.findUnique({ where: { communityId_userId: { communityId: invite.communityId, userId: currentUserId } } });
    if (existingMember?.status === 'active') {
      return serializeCommunity(invite.community, new Map(), { membership: existingMember });
    }
    if (existingMember?.status === 'banned') throw httpError('Доступ в это сообщество ограничен модерацией.', 403, 'COMMUNITY_MEMBER_BANNED');

    const member = await tx.communityMember.upsert({
      where: { communityId_userId: { communityId: invite.communityId, userId: currentUserId } },
      update: { status: 'active', role: existingMember?.role && existingMember.role !== 'owner' ? existingMember.role : 'member', mutedUntil: null, mutedReason: null, bannedAt: null, banReason: null },
      create: { communityId: invite.communityId, userId: currentUserId, role: 'member', status: 'active' },
    });

    await tx.communityJoinRequest.updateMany({ where: { communityId: invite.communityId, userId: currentUserId, status: 'pending' }, data: { status: 'approved', reviewedAt: new Date() } }).catch(() => null);
    await tx.communityInvite.update({ where: { id: invite.id }, data: { usesCount: { increment: 1 } } });

    const [memberCount, pendingCount] = await Promise.all([
      tx.communityMember.count({ where: { communityId: invite.communityId, status: 'active' } }),
      tx.communityJoinRequest.count({ where: { communityId: invite.communityId, status: 'pending' } }),
    ]);

    const community = await tx.community.update({
      where: { id: invite.communityId },
      data: { memberCount, pendingRequestCount: pendingCount, lastActivityAt: new Date() },
      include: { owner: { include: { publicProfile: true } }, rules: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
    });

    await tx.communityModerationAction.create({
      data: { communityId: invite.communityId, actorUserId: currentUserId, action: 'member.joined_by_invite', metadata: { invite_id: invite.id, code: invite.code } },
    }).catch(() => null);

    await notifyCommunityManagers(community, currentUserId, {
      type: 'community_member_joined',
      title: 'Новый участник по приглашению',
      body: 'Пользователь принял invite-код и вступил в сообщество.',
      targetLabel: community.name,
      payload: { inviteId: invite.id, tab: 'members' },
    }, tx);

    return serializeCommunity(community, new Map(), { membership: member });
  });
}

function communityTagScore(sourceTags = [], targetTags = []) {
  const source = new Set((Array.isArray(sourceTags) ? sourceTags : []).map((item) => String(item).toLowerCase()));
  if (!source.size) return 0;
  return (Array.isArray(targetTags) ? targetTags : []).reduce((score, tag) => score + (source.has(String(tag).toLowerCase()) ? 4 : 0), 0);
}

export async function listCommunityDiscovery(currentUserId, { limit = 8 } = {}, db = prisma) {
  const take = Math.max(3, Math.min(Number(limit) || 8, 16));
  const memberships = await db.communityMember.findMany({
    where: { userId: currentUserId, status: 'active' },
    include: { community: true },
    orderBy: { joinedAt: 'desc' },
    take: 80,
  }).catch(() => []);
  const membershipMap = new Map(memberships.map((item) => [item.communityId, { role: item.role, status: item.status }]));
  const memberIds = memberships.map((item) => item.communityId);
  const myTags = [...new Set(memberships.flatMap((item) => Array.isArray(item.community?.tags) ? item.community.tags : []))];

  const candidates = await db.community.findMany({
    where: { visibility: { in: ['public', 'closed'] }, discoverable: true, ...(memberIds.length ? { id: { notIn: memberIds } } : {}) },
    include: { owner: { include: { publicProfile: true } } },
    orderBy: [{ isOfficial: 'desc' }, { lastActivityAt: 'desc' }, { memberCount: 'desc' }],
    take: 120,
  }).catch(() => []);

  const recommended = candidates
    .map((community) => ({
      community,
      score: communityTagScore(myTags, community.tags) + (community.isOfficial ? 8 : 0) + Math.min(Number(community.memberCount || 0), 200) / 20,
    }))
    .sort((a, b) => b.score - a.score || String(a.community.name).localeCompare(String(b.community.name)))
    .slice(0, take)
    .map((item) => serializeCommunity(item.community, membershipMap));

  const trending = [...candidates]
    .sort((a, b) => Number(b.memberCount || 0) - Number(a.memberCount || 0) || new Date(b.lastActivityAt || b.updatedAt || 0) - new Date(a.lastActivityAt || a.updatedAt || 0))
    .slice(0, take)
    .map((community) => serializeCommunity(community, membershipMap));

  const mine = memberships.slice(0, take).map((item) => serializeCommunity(item.community, membershipMap, { membership: item }));

  return { recommended, trending, mine, tags: myTags.slice(0, 10) };
}

export async function listSimilarCommunities(slug, currentUserId, { limit = 6 } = {}, db = prisma) {
  const community = await db.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
  if (!community) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');
  const membership = await getCommunityMembership(community.id, currentUserId, db);
  if (community.visibility === 'private' && !membership) throw httpError('Сообщество не найдено.', 404, 'COMMUNITY_NOT_FOUND');

  const tags = Array.isArray(community.tags) ? community.tags : [];
  const rows = await db.community.findMany({
    where: { id: { not: community.id }, visibility: { in: ['public', 'closed'] }, discoverable: true },
    include: { owner: { include: { publicProfile: true } } },
    orderBy: [{ isOfficial: 'desc' }, { memberCount: 'desc' }, { lastActivityAt: 'desc' }],
    take: 80,
  }).catch(() => []);
  const memberships = await db.communityMember.findMany({ where: { userId: currentUserId, status: 'active', communityId: { in: rows.map((item) => item.id) } } }).catch(() => []);
  const membershipMap = new Map(memberships.map((item) => [item.communityId, item]));
  return rows
    .map((item) => ({ community: item, score: communityTagScore(tags, item.tags) + Math.min(Number(item.memberCount || 0), 200) / 50 }))
    .filter((item) => item.score > 0 || tags.length === 0)
    .sort((a, b) => b.score - a.score || String(a.community.name).localeCompare(String(b.community.name)))
    .slice(0, Math.max(1, Math.min(Number(limit) || 6, 12)))
    .map((item) => serializeCommunity(item.community, membershipMap));
}

export async function listProfileCommunities(targetUserId, viewerUserId, { limit = 8 } = {}, db = prisma) {
  const target = Number(targetUserId);
  const viewer = Number(viewerUserId);
  if (!target || !viewer) throw httpError('Некорректный пользователь.', 400, 'USER_INVALID');

  const [preferences, relation] = await Promise.all([
    getUserPreferences(target, db).catch(() => ({ community_visibility: 'connections' })),
    getViewerRelation(viewer, target, db).catch(() => ({ is_self: viewer === target, is_friend: false, has_connection: false })),
  ]);
  const canSee = isVisibilityAllowed(preferences.community_visibility || 'connections', relation);
  if (!canSee) return { visible: false, communities: [], count: 0 };

  const rows = await db.communityMember.findMany({
    where: { userId: target, status: 'active' },
    include: { community: { include: { owner: { include: { publicProfile: true } } } } },
    orderBy: { joinedAt: 'desc' },
    take: Math.max(1, Math.min(Number(limit) || 8, 24)),
  }).catch(() => []);
  const membershipMap = new Map(rows.map((item) => [item.communityId, { role: item.role, status: item.status }]));
  const communities = rows
    .map((item) => item.community)
    .filter((community) => community && (community.visibility !== 'private' || relation.is_self))
    .map((community) => serializeCommunity(community, membershipMap));
  return { visible: true, communities, count: communities.length };
}

export const communitySerializers = {
  serializeJoinRequest,
  serializeInvite,
  serializeMember,
  serializeModerationAction,
  serializeCommunityPostReport,
  serializeCommunityCommentReport,
};

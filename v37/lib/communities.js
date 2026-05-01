import prisma from '@/lib/prisma';

function normalizeQuery(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  return tags
    .map((tag) => String(tag || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    })
    .slice(0, 10);
}

export function serializeCommunity(community, membershipMap = new Map()) {
  const tags = Array.isArray(community?.tags) ? community.tags : [];
  const membership = membershipMap.get(community.id) || null;
  return {
    id: community.id,
    slug: community.slug,
    name: community.name,
    description: community.description || '',
    city: community.city || null,
    visibility: community.visibility,
    is_official: Boolean(community.isOfficial),
    avatar_tone: community.avatarTone || 'violet',
    member_count: Number(community.memberCount || 0),
    tags,
    last_activity_at: community.lastActivityAt?.toISOString?.() || null,
    created_at: community.createdAt?.toISOString?.() || null,
    relation: membership ? 'member' : 'none',
    member_role: membership?.role || null,
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

export async function searchCommunities(currentUserId, rawQuery, { limit = 12 } = {}, db = prisma) {
  const query = normalizeQuery(rawQuery);
  const tokens = tokenize(query);
  if (!tokens.length) return { query, communities: [] };

  const communities = await db.community.findMany({
    where: { visibility: 'public' },
    orderBy: [{ isOfficial: 'desc' }, { lastActivityAt: 'desc' }, { updatedAt: 'desc' }],
    take: 120,
  }).catch(() => []);

  const ranked = communities
    .map((community) => ({ community, score: rankCommunity(community, tokens) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || String(a.community.name).localeCompare(String(b.community.name)))
    .slice(0, limit);

  const ids = ranked.map((item) => item.community.id);
  const memberships = ids.length
    ? await db.communityMember.findMany({
        where: { userId: currentUserId, communityId: { in: ids } },
        select: { communityId: true, role: true },
      }).catch(() => [])
    : [];
  const membershipMap = new Map(memberships.map((item) => [item.communityId, item]));

  return {
    query,
    communities: ranked.map((item) => ({
      ...serializeCommunity(item.community, membershipMap),
      search_score: Number(item.score.toFixed(2)),
    })),
  };
}

export async function listAdminCommunities({ status = 'all', limit = 40 } = {}, db = prisma) {
  const where = status === 'official' ? { isOfficial: true } : status === 'public' ? { visibility: 'public' } : {};
  const communities = await db.community.findMany({
    where,
    orderBy: [{ isOfficial: 'desc' }, { updatedAt: 'desc' }],
    take: Math.max(1, Math.min(Number(limit) || 40, 100)),
  });
  return communities.map((community) => serializeCommunity(community));
}

export async function createCommunity(input, db = prisma) {
  const name = String(input?.name || '').trim().slice(0, 80);
  if (name.length < 2) {
    const error = new Error('Название сообщества слишком короткое.');
    error.status = 400;
    throw error;
  }

  const description = String(input?.description || '').trim().slice(0, 240) || null;
  const city = String(input?.city || '').trim().slice(0, 80) || null;
  const visibility = String(input?.visibility || 'public').trim().toLowerCase() === 'private' ? 'private' : 'public';
  const isOfficial = Boolean(input?.isOfficial);
  const avatarTone = ['violet', 'blue', 'green', 'orange', 'stone'].includes(String(input?.avatarTone || '').trim())
    ? String(input.avatarTone).trim()
    : 'violet';
  const tags = normalizeTags(input?.tags);
  const explicitSlug = normalizeSlug(input?.slug || '');
  const baseSlug = explicitSlug || normalizeSlug(name);
  if (!baseSlug) {
    const error = new Error('Не удалось сформировать slug сообщества.');
    error.status = 400;
    throw error;
  }

  let slug = baseSlug;
  let counter = 1;
  while (await db.community.findUnique({ where: { slug } })) {
    counter += 1;
    slug = `${baseSlug}-${counter}`.slice(0, 48);
  }

  return db.community.create({
    data: {
      slug,
      name,
      description,
      city,
      visibility,
      isOfficial,
      avatarTone,
      tags,
      memberCount: 0,
    },
  });
}

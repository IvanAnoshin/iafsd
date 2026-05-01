import prisma from '@/lib/prisma';

const TONE_SET = new Set(['violet', 'mint', 'blue', 'gold', 'rose', 'slate']);
const STATUS_SET = new Set(['recent', 'online', 'creator', 'team', 'trusted']);

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.');
}

export function normalizeProfileInput(value, max = 160) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function normalizeHandleInput(value) {
  const raw = String(value || '').trim().replace(/^@+/, '');
  if (!raw) return null;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 24) || null;
}

export async function generateUniqueHandle(tx, user, preferredHandle = null) {
  const baseCandidates = [
    preferredHandle,
    slugify(`${user.firstName}.${user.lastName}`),
    slugify(`${user.firstName}${user.lastName}`),
    slugify(user.firstName),
    `user${user.id}`,
  ].filter(Boolean);

  for (const base of baseCandidates) {
    const existing = await tx.userPublicProfile.findUnique({ where: { handle: base } });
    if (!existing || existing.userId === user.id) return base;
  }

  const safeBase = baseCandidates[0] || `user${user.id}`;
  for (let index = 1; index <= 200; index += 1) {
    const candidate = `${safeBase}.${index}`.slice(0, 24);
    const existing = await tx.userPublicProfile.findUnique({ where: { handle: candidate } });
    if (!existing || existing.userId === user.id) return candidate;
  }

  return `user${user.id}`;
}

export async function ensureUserPublicProfile(userId, db = prisma) {
  const run = typeof db?.$transaction === 'function'
    ? db.$transaction.bind(db)
    : async (callback) => callback(db);

  return run(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { publicProfile: true },
    });

    if (!user) return null;
    if (user.publicProfile) return user;

    const handle = await generateUniqueHandle(tx, user);
    const publicProfile = await tx.userPublicProfile.create({
      data: {
        userId: user.id,
        handle,
        tone: 'violet',
        status: 'recent',
        occupation: null,
        city: null,
        bio: null,
        relationshipStatus: null,
      },
    });

    return {
      ...user,
      publicProfile,
    };
  });
}

export function serializeEditableProfile(userRecord) {
  if (!userRecord) return null;

  const profile = userRecord.publicProfile || {};
  return {
    id: userRecord.id,
    first_name: userRecord.firstName,
    last_name: userRecord.lastName,
    handle: profile.handle ? `@${profile.handle}` : null,
    handle_raw: profile.handle || null,
    bio: profile.bio || '',
    occupation: profile.occupation || '',
    city: profile.city || '',
    relationship_status: profile.relationshipStatus || '',
    tone: TONE_SET.has(profile.tone) ? profile.tone : 'violet',
    status: STATUS_SET.has(profile.status) ? profile.status : 'recent',
    mutual_hint: Number(profile.mutualHint || 0),
    created_at: userRecord.createdAt,
    updated_at: profile.updatedAt || null,
  };
}

export function sanitizeProfileUpdate(body = {}) {
  const tone = TONE_SET.has(String(body.tone || '').trim()) ? String(body.tone).trim() : undefined;
  const status = STATUS_SET.has(String(body.status || '').trim()) ? String(body.status).trim() : undefined;
  const handle = normalizeHandleInput(body.handle);
  const bio = normalizeProfileInput(body.bio, 240);
  const occupation = normalizeProfileInput(body.occupation, 80);
  const city = normalizeProfileInput(body.city, 80);
  const relationshipStatus = normalizeProfileInput(body.relationship_status, 80);

  return {
    handle,
    bio,
    occupation,
    city,
    relationshipStatus,
    tone,
    status,
  };
}

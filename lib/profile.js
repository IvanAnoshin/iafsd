import prisma from '@/lib/prisma';

const TONE_SET = new Set(['violet', 'mint', 'blue', 'gold', 'rose', 'slate']);
const STATUS_SET = new Set(['recent', 'online', 'creator', 'team', 'trusted']);

const PROFILE_LANGUAGE_LABELS = new Map([
  ['Русский', 'Русский'],
  ['Английский', 'Английский'],
  ['Белорусский', 'Белорусский'],
  ['Украинский', 'Украинский'],
  ['Казахский', 'Казахский'],
  ['Армянский', 'Армянский'],
  ['Грузинский', 'Грузинский'],
  ['Азербайджанский', 'Азербайджанский'],
  ['Немецкий', 'Немецкий'],
  ['Французский', 'Французский'],
  ['Испанский', 'Испанский'],
  ['Итальянский', 'Итальянский'],
  ['Португальский', 'Португальский'],
  ['Польский', 'Польский'],
  ['Чешский', 'Чешский'],
  ['Литовский', 'Литовский'],
  ['Латышский', 'Латышский'],
  ['Эстонский', 'Эстонский'],
  ['Турецкий', 'Турецкий'],
  ['Арабский', 'Арабский'],
  ['Китайский', 'Китайский'],
  ['Японский', 'Японский'],
  ['Корейский', 'Корейский'],
  ['Хинди', 'Хинди'],
]);

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

export function normalizeProfileAssetUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('/uploads/posts/') || raw.startsWith('/api/storage/post/')) return raw.slice(0, 4000);
  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 4000);
  return null;
}

export function normalizeProfileInterests(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const result = [];
  for (const item of source) {
    const text = String(item || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= 8) break;
  }
  return result;
}

function normalizeProfileList(value, maxItemLength = 40) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const result = [];
  for (const item of source) {
    const text = String(item || '').trim().replace(/\s+/g, ' ').slice(0, maxItemLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(PROFILE_LANGUAGE_LABELS.get(text) || text);
  }
  return result;
}

export function normalizeProfilePersonalDetails(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    hometown: normalizeProfileInput(source.hometown, 80),
    birth_date: normalizeProfileInput(source.birth_date, 20),
    workplace: normalizeProfileInput(source.workplace, 100),
    school: normalizeProfileInput(source.school, 100),
    education: normalizeProfileInput(source.education, 100),
    military_service: normalizeProfileInput(source.military_service, 80),
    languages: normalizeProfileList(source.languages, 40),
    website: normalizeProfileInput(source.website, 160),
    worldview: normalizeProfileInput(source.worldview, 80),
    quote: normalizeProfileInput(source.quote, 180),
  };
}

export function hasProfilePersonalDetails(value = {}) {
  const details = normalizeProfilePersonalDetails(value);
  return Boolean(
    details.hometown
      || details.birth_date
      || details.workplace
      || details.school
      || details.education
      || details.military_service
      || details.languages.length
      || details.website
      || details.worldview
      || details.quote
  );
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
        coverTone: 'violet',
        status: 'recent',
        occupation: null,
        city: null,
        bio: null,
        relationshipStatus: null,
        personalDetails: {},
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
    personal_details: normalizeProfilePersonalDetails(profile.personalDetails || {}),
    tone: TONE_SET.has(profile.tone) ? profile.tone : 'violet',
    cover_tone: TONE_SET.has(profile.coverTone) ? profile.coverTone : (TONE_SET.has(profile.tone) ? profile.tone : 'violet'),
    avatar_url: profile.avatarUrl || '',
    cover_url: profile.coverUrl || '',
    interests: normalizeProfileInterests(profile.interests || []),
    status: STATUS_SET.has(profile.status) ? profile.status : 'recent',
    mutual_hint: Number(profile.mutualHint || 0),
    created_at: userRecord.createdAt,
    updated_at: profile.updatedAt || null,
  };
}

export function sanitizeProfileUpdate(body = {}) {
  const tone = TONE_SET.has(String(body.tone || '').trim()) ? String(body.tone).trim() : undefined;
  const coverTone = TONE_SET.has(String(body.cover_tone || '').trim()) ? String(body.cover_tone).trim() : undefined;
  const status = STATUS_SET.has(String(body.status || '').trim()) ? String(body.status).trim() : undefined;
  const handle = normalizeHandleInput(body.handle);
  const bio = normalizeProfileInput(body.bio, 240);
  const occupation = normalizeProfileInput(body.occupation, 80);
  const city = normalizeProfileInput(body.city, 80);
  const relationshipStatus = normalizeProfileInput(body.relationship_status, 80);
  const personalDetails = normalizeProfilePersonalDetails(body.personal_details);
  const avatarUrl = normalizeProfileAssetUrl(body.avatar_url);
  const coverUrl = normalizeProfileAssetUrl(body.cover_url);
  const interests = normalizeProfileInterests(body.interests);

  return {
    handle,
    bio,
    occupation,
    city,
    relationshipStatus,
    personalDetails,
    tone,
    coverTone,
    avatarUrl,
    coverUrl,
    interests,
    status,
  };
}

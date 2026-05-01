import prisma from '@/lib/prisma';
import { createOrOpenDirectConversation, sendMessageToConversation } from '@/lib/chat';
import { assertMediaReferencesBelongToScope, sanitizeClientMediaUrl } from '@/lib/media-security';

const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DURATION_MINUTES = 24 * 60;
const MIN_DURATION_MINUTES = 10;
const MAX_MINUTE_DURATION = 59;
const MIN_HOUR_DURATION = 60;
const MAX_HOUR_DURATION = 48 * 60;
const MAX_STORIES_PER_USER = 12;
const MAX_EXTENSIONS = 2;
const globalStore = globalThis;

function getStore() {
  if (!globalStore.__friendscapeStoriesFoundationStore) {
    globalStore.__friendscapeStoriesFoundationStore = {
      seeded: false,
      seq: 1,
      stories: [],
      seenByStory: new Map(),
      reactionsByStory: new Map(),
    };
  }
  return globalStore.__friendscapeStoriesFoundationStore;
}

function asIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function clip(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function normalizeKind(input = '') {
  const kind = String(input || '').trim().toLowerCase();
  if (kind === 'video' || kind === 'text') return kind;
  return 'photo';
}

function normalizeMomentDuration(value, fallback = DEFAULT_DURATION_MINUTES) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  const isMinuteDuration = rounded >= MIN_DURATION_MINUTES && rounded <= MAX_MINUTE_DURATION;
  const isHourDuration = rounded >= MIN_HOUR_DURATION && rounded <= MAX_HOUR_DURATION && rounded % 60 === 0;
  if (!isMinuteDuration && !isHourDuration) {
    throw Object.assign(new Error('Время жизни момента должно быть от 10 до 59 минут или от 1 до 48 часов.'), { status: 400 });
  }
  return rounded;
}

function buildMomentExpiry(startValue = Date.now(), durationMinutes = DEFAULT_DURATION_MINUTES) {
  const start = startValue instanceof Date ? startValue.getTime() : new Date(startValue).getTime();
  const safeStart = Number.isFinite(start) ? start : Date.now();
  return new Date(safeStart + normalizeMomentDuration(durationMinutes) * 60 * 1000);
}

function getMomentExtensionsLeft(story) {
  const used = Number(story?.extensionCount || 0) || 0;
  const max = Number(story?.maxExtensions || MAX_EXTENSIONS) || MAX_EXTENSIONS;
  return Math.max(0, max - used);
}

function canExtendMoment(story) {
  if (!story) return false;
  return getMomentExtensionsLeft(story) > 0 && new Date(story.expiresAt).getTime() > Date.now();
}

function getMomentTimeLeft(story) {
  if (!story?.expiresAt) return 0;
  const expiresAt = new Date(story.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(0, expiresAt - Date.now());
}

function buildAuthorLabel(user) {
  const first = clip(user?.firstName, 40);
  const last = clip(user?.lastName, 40);
  return `${first} ${last}`.trim() || 'Пользователь';
}

function hasRenderableStoryMedia(story) {
  if (!story) return false;
  const kind = normalizeKind(story.kind);
  if (kind === 'text') return true;
  return Boolean(clip(story.mediaUrl || story.media_url || story.previewUrl || story.preview_url, 500));
}

function isDisplayableStory(story) {
  if (!story) return false;
  return normalizeKind(story.kind) === 'text' || hasRenderableStoryMedia(story);
}

function isStoryRenderable(story) {
  return Boolean(story) && isDisplayableStory(story);
}


function getReactionBucket(store, storyId) {
  const key = String(storyId);
  const bucket = store.reactionsByStory.get(key);
  if (bucket && typeof bucket === 'object') return bucket;
  const fresh = { plus: new Set(), minus: new Set() };
  store.reactionsByStory.set(key, fresh);
  return fresh;
}

function getSerializedReactionState(store, storyId, viewerId = null) {
  const bucket = getReactionBucket(store, storyId);
  const viewer = Number(viewerId);
  const myReaction = Number.isInteger(viewer) && viewer > 0
    ? (bucket.plus.has(viewer) ? 'plus' : bucket.minus.has(viewer) ? 'minus' : null)
    : null;
  return {
    plus_count: bucket.plus.size,
    minus_count: bucket.minus.size,
    my_reaction: myReaction,
  };
}

function getSeenCount(store, storyId) {
  const bucket = store.seenByStory.get(String(storyId));
  return bucket instanceof Set ? bucket.size : 0;
}

function serializeStory(story, viewerId = null, store = getStore()) {
  if (!story) return null;
  const viewer = Number(viewerId);
  const bucket = store.seenByStory.get(String(story.id));
  const seen = Number.isInteger(viewer) && viewer > 0 ? Boolean(bucket?.has(viewer)) : false;
  const isMine = Number.isInteger(viewer) && viewer > 0 && Number(story.authorId) === viewer;
  const durationMinutes = Number(story.durationMinutes || story.duration_minutes || 0) || DEFAULT_DURATION_MINUTES;
  const extensionCount = Number(story.extensionCount || story.extension_count || 0) || 0;
  const maxExtensions = Number(story.maxExtensions || story.max_extensions || MAX_EXTENSIONS) || MAX_EXTENSIONS;
  const timeLeftMs = getMomentTimeLeft(story);
  const reactionState = getSerializedReactionState(store, story.id, viewer);
  return {
    id: String(story.id),
    item_id: String(story.itemId || story.id),
    kind: normalizeKind(story.kind),
    title: clip(story.title, 120) || 'Момент',
    subtitle: clip(story.subtitle, 280) || '',
    preview_url: story.previewUrl || '',
    media_url: story.mediaUrl || story.previewUrl || '',
    deep_link: story.deepLink || '',
    audience: story.audience || 'friends',
    duration_ms: Number(story.durationMs || 0) || null,
    duration_minutes: durationMinutes,
    initial_duration_minutes: Number(story.initialDurationMinutes || story.initial_duration_minutes || durationMinutes) || durationMinutes,
    source: story.source || 'stories',
    is_renderable: isStoryRenderable(story),
    archived: Boolean(story.archived),
    seen,
    seen_count: getSeenCount(store, story.id),
    reply_count: Number(story.replyCount || story.reply_count || 0) || 0,
    is_mine: isMine,
    plus_count: reactionState.plus_count,
    minus_count: reactionState.minus_count,
    my_reaction: reactionState.my_reaction,
    extension_count: extensionCount,
    max_extensions: maxExtensions,
    extensions_left: Math.max(0, maxExtensions - extensionCount),
    can_extend: isMine && canExtendMoment(story),
    time_left_ms: timeLeftMs,
    created_at: asIso(story.createdAt),
    expires_at: asIso(story.expiresAt),
    last_extended_at: asIso(story.lastExtendedAt),
    author: {
      id: Number(story.authorId),
      name: story.authorLabel || 'Пользователь',
      handle: story.authorHandle || null,
      tone: story.authorTone || 'violet',
    },
  };
}

function sortStories(items = []) {
  return [...items].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export async function listStoriesFoundation(viewerId, options = {}, db = prisma) {
  const store = getStore();
  const viewer = Number(viewerId);
  const now = Date.now();
  const userId = Number(options.userId || options.user_id || 0) || null;
  const storyId = clip(options.storyId || options.story_id, 191) || null;
  const includeExpired = Boolean(options.includeExpired || options.include_expired);
  const limit = Math.max(1, Math.min(30, Number(options.limit || 12) || 12));

  let stories = sortStories(store.stories).filter((story) => (includeExpired || new Date(story.expiresAt).getTime() > now || story.archived) && isStoryRenderable(story));
  if (userId) stories = stories.filter((story) => Number(story.authorId) === userId);
  if (storyId) {
    const target = stories.find((story) => String(story.id) === storyId);
    if (target) {
      stories = [target, ...stories.filter((story) => String(story.id) !== storyId)];
    }
  }

  const visible = stories.slice(0, limit);
  const items = visible.map((story) => serializeStory(story, viewer, store));
  const archive = sortStories(store.stories)
    .filter((story) => isStoryRenderable(story) && (Number(story.authorId) === viewer || story.archived || new Date(story.expiresAt).getTime() <= now))
    .slice(0, 8)
    .map((story) => serializeStory({ ...story, archived: true }, viewer, store));

  const highlights = archive.length ? [{
    id: 'hl-moments',
    title: 'Моменты',
    cover_tone: 'violet',
    count: archive.length,
  }] : [];

  return {
    items,
    archive,
    highlights,
    total: items.length,
    source: clip(options.source, 40) || 'stories',
  };
}

export async function createStoryFoundation(userId, payload = {}, db = prisma) {
  const viewer = Number(userId);
  if (!Number.isInteger(viewer) || viewer <= 0) {
    throw Object.assign(new Error('Требуется авторизация.'), { status: 401 });
  }

  const author = await db.user.findUnique({
    where: { id: viewer },
    include: { publicProfile: true },
  });
  if (!author) {
    throw Object.assign(new Error('Пользователь не найден.'), { status: 404 });
  }

  const store = getStore();
  const authorStories = store.stories.filter((story) => Number(story.authorId) === viewer && new Date(story.expiresAt).getTime() > Date.now());
  if (authorStories.length >= MAX_STORIES_PER_USER) {
    throw Object.assign(new Error('Слишком много активных моментов. Удали старые или дождись архива.'), { status: 400 });
  }

  const kind = normalizeKind(payload.kind || payload.template || payload.type);
  const title = clip(payload.title || payload.canvasTitle || payload.text || payload.caption || '', 120)
    || (kind === 'video' ? 'Видео момента' : kind === 'text' ? 'Текст момента' : 'Фото момента');
  const subtitle = clip(payload.subtitle || payload.canvasText || payload.description || payload.copy || '', 280)
    || 'Момент опубликован.';
  const previewUrl = sanitizeClientMediaUrl(payload.preview_url || payload.previewUrl);
  const mediaUrl = sanitizeClientMediaUrl(payload.media_url || payload.mediaUrl);
  await assertMediaReferencesBelongToScope({
    db,
    media: mediaUrl || previewUrl ? [{ url: mediaUrl, thumbUrl: previewUrl }] : [],
    ownerUserId: viewer,
    allowedSurfaces: ['story'],
    allowedScopeIds: [viewer],
    label: 'медиа момента',
  });
  const audience = clip(payload.audience, 40) || 'friends';
  const mediaDurationMs = Number(payload.duration_ms || payload.durationMs || 0) || null;
  const durationMinutes = normalizeMomentDuration(payload.duration_minutes || payload.durationMinutes || DEFAULT_DURATION_MINUTES);
  const createdAt = new Date();
  const nextId = `story-${Date.now()}-${store.seq++}`;
  const story = {
    id: nextId,
    itemId: `${nextId}-item`,
    authorId: viewer,
    authorLabel: buildAuthorLabel(author),
    authorHandle: author.publicProfile?.handle || null,
    authorTone: author.publicProfile?.tone || 'violet',
    kind,
    title,
    subtitle,
    previewUrl,
    mediaUrl,
    deepLink: `/stories?story=${encodeURIComponent(nextId)}&user=${viewer}&source=chat&mode=viewer`,
    audience,
    durationMs: mediaDurationMs,
    durationMinutes,
    initialDurationMinutes: durationMinutes,
    replyCount: 0,
    extensionCount: 0,
    maxExtensions: MAX_EXTENSIONS,
    lastExtendedAt: null,
    source: 'composer',
    archived: false,
    createdAt,
    expiresAt: buildMomentExpiry(createdAt, durationMinutes),
  };

  store.stories.unshift(story);
  return serializeStory(story, viewer, store);
}

export async function extendStoryFoundation(userId, storyId, payload = {}, db = prisma) {
  const viewer = Number(userId);
  if (!Number.isInteger(viewer) || viewer <= 0) {
    throw Object.assign(new Error('Требуется авторизация.'), { status: 401 });
  }
  const id = clip(storyId, 191);
  const store = getStore();
  const story = store.stories.find((item) => String(item.id) === id);
  if (!story) throw Object.assign(new Error('Момент не найден.'), { status: 404 });
  if (Number(story.authorId) !== viewer) {
    throw Object.assign(new Error('Можно продлевать только свои моменты.'), { status: 403 });
  }
  if (new Date(story.expiresAt).getTime() <= Date.now()) {
    throw Object.assign(new Error('Нельзя продлить уже истёкший момент.'), { status: 400 });
  }
  if (!canExtendMoment(story)) {
    throw Object.assign(new Error('Лимит продлений исчерпан.'), { status: 400 });
  }

  const durationMinutes = normalizeMomentDuration(payload.duration_minutes || payload.durationMinutes || 0);
  const nextExpiry = new Date(story.expiresAt);
  nextExpiry.setMinutes(nextExpiry.getMinutes() + durationMinutes);
  story.expiresAt = nextExpiry;
  story.extensionCount = Number(story.extensionCount || 0) + 1;
  story.lastExtendedAt = new Date();

  return serializeStory(story, viewer, store);
}

export async function markStorySeenFoundation(userId, storyId, db = prisma) {
  const viewer = Number(userId);
  const id = clip(storyId, 191);
  const store = getStore();
  const story = store.stories.find((item) => String(item.id) === id);
  if (!story) throw Object.assign(new Error('Момент не найден.'), { status: 404 });
  if (Number.isInteger(viewer) && viewer > 0) {
    const bucket = store.seenByStory.get(id) || new Set();
    bucket.add(viewer);
    store.seenByStory.set(id, bucket);
  }
  return serializeStory(story, viewer, store);
}

export async function replyToStoryFoundation(userId, storyId, payload = {}, db = prisma) {
  const viewer = Number(userId);
  const id = clip(storyId, 191);
  const store = getStore();
  const story = store.stories.find((item) => String(item.id) === id);
  if (!story) throw Object.assign(new Error('Момент не найден.'), { status: 404 });
  if (Number(story.authorId) === viewer) {
    throw Object.assign(new Error('Нельзя ответить на свой момент в этом режиме.'), { status: 400 });
  }

  const conversation = await createOrOpenDirectConversation(viewer, Number(story.authorId), db);
  const text = clip(payload.text || payload.message || '', 1000) || 'Ответ на момент';
  const message = await sendMessageToConversation(viewer, conversation.id, {
    type: 'story_reply',
    text,
    metadata: {
      story_ref: {
        story_id: story.id,
        item_id: story.itemId,
        author_name: story.authorLabel,
        title: story.title,
        subtitle: story.subtitle,
        preview_url: story.previewUrl,
        deep_link: story.deepLink,
        expires_at: asIso(story.expiresAt),
      },
    },
  }, db);

  story.replyCount = Number(story.replyCount || 0) + 1;
  await markStorySeenFoundation(viewer, id, db).catch(() => null);

  return {
    ok: true,
    conversation_id: conversation.id,
    target_user_id: Number(story.authorId),
    message,
    story: serializeStory(story, viewer, store),
  };
}



export async function deleteStoryFoundation(userId, storyId, db = prisma) {
  const viewer = Number(userId);
  if (!Number.isInteger(viewer) || viewer <= 0) {
    throw Object.assign(new Error('Требуется авторизация.'), { status: 401 });
  }
  const id = clip(storyId, 191);
  const store = getStore();
  const index = store.stories.findIndex((item) => String(item.id) === id);
  if (index < 0) throw Object.assign(new Error('Момент не найден.'), { status: 404 });
  const story = store.stories[index];
  if (Number(story.authorId) !== viewer) {
    throw Object.assign(new Error('Можно удалить только свой момент.'), { status: 403 });
  }
  store.stories.splice(index, 1);
  store.seenByStory.delete(id);
  store.reactionsByStory.delete(id);
  return { ok: true, id };
}

export async function toggleStoryReactionFoundation(userId, storyId, payload = {}, db = prisma) {
  const viewer = Number(userId);
  if (!Number.isInteger(viewer) || viewer <= 0) {
    throw Object.assign(new Error('Требуется авторизация.'), { status: 401 });
  }
  const id = clip(storyId, 191);
  const story = getStore().stories.find((item) => String(item.id) === id);
  if (!story) throw Object.assign(new Error('Момент не найден.'), { status: 404 });
  if (Number(story.authorId) === viewer) {
    throw Object.assign(new Error('Нельзя оценивать свой момент.'), { status: 400 });
  }
  if (new Date(story.expiresAt).getTime() <= Date.now()) {
    throw Object.assign(new Error('Нельзя оценить истёкший момент.'), { status: 400 });
  }
  const reaction = String(payload.reaction || payload.value || '').trim().toLowerCase();
  if (reaction !== 'plus' && reaction !== 'minus') {
    throw Object.assign(new Error('Поддерживаются только плюс и минус.'), { status: 400 });
  }
  const store = getStore();
  const bucket = getReactionBucket(store, id);
  const target = bucket[reaction];
  const opposite = bucket[reaction === 'plus' ? 'minus' : 'plus'];
  if (target.has(viewer)) target.delete(viewer);
  else {
    target.add(viewer);
    opposite.delete(viewer);
  }
  return serializeStory(story, viewer, store);
}

export { DEFAULT_DURATION_MINUTES, MAX_EXTENSIONS, normalizeMomentDuration, canExtendMoment, getMomentExtensionsLeft, getMomentTimeLeft, isStoryRenderable };

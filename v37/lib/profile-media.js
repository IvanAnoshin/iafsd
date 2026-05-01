import prisma from '@/lib/prisma';

const FILTER_SET = new Set(['all', 'photos', 'videos', 'cards']);
const GRID_SET = new Set(['comfortable', 'compact']);

function safePayload(payload) {
  return payload && typeof payload === 'object' ? payload : {};
}

export function normalizeMediaFilter(value) {
  const next = String(value || '').trim().toLowerCase();
  return FILTER_SET.has(next) ? next : 'all';
}

export function normalizeMediaGrid(value) {
  const next = String(value || '').trim().toLowerCase();
  return GRID_SET.has(next) ? next : 'comfortable';
}

export function serializeMediaSettings(record) {
  return {
    default_filter: normalizeMediaFilter(record?.defaultFilter),
    grid_mode: normalizeMediaGrid(record?.gridMode),
    show_cards: Boolean(record?.showCards ?? true),
    persistence: record ? 'database' : 'memory',
  };
}

export async function ensureUserMediaSettings(userId, db = prisma) {
  if (!db?.userMediaSettings) {
    return {
      userId,
      defaultFilter: 'all',
      gridMode: 'comfortable',
      showCards: true,
      __fallback: true,
    };
  }

  try {
    return await db.userMediaSettings.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        defaultFilter: 'all',
        gridMode: 'comfortable',
        showCards: true,
      },
    });
  } catch (error) {
    console.warn('media settings fallback enabled:', error?.code || error?.message || error);
    return {
      userId,
      defaultFilter: 'all',
      gridMode: 'comfortable',
      showCards: true,
      __fallback: true,
    };
  }
}

function mediaKindFromEntry(entry = {}) {
  const raw = String(entry.kind || entry.type || '').trim().toLowerCase();
  if (raw === 'video') return 'video';
  if (raw === 'card' || raw === 'link' || raw === 'repost') return 'card';
  return 'photo';
}

function makePreview(entry = {}, fallbackGradient = 'linear-gradient(135deg, #7f8cff, #89d0ff 60%, #9de0c5)') {
  if (entry.url) {
    return `linear-gradient(180deg, rgba(10,10,12,.08), rgba(10,10,12,.28)), url(${entry.url}) center/cover`;
  }
  if (entry.thumbnail) {
    return `linear-gradient(180deg, rgba(10,10,12,.08), rgba(10,10,12,.28)), url(${entry.thumbnail}) center/cover`;
  }
  return entry.bg || fallbackGradient;
}

export function extractMediaItemsFromPost(post) {
  if (!post) return [];

  const payload = safePayload(post.payload);
  const author = post.author || null;
  const base = {
    postId: post.id,
    createdAt: post.createdAt,
    location: post.location || null,
    author: author ? {
      id: author.id,
      first_name: author.firstName,
      last_name: author.lastName,
    } : null,
  };

  const items = [];

  if (Array.isArray(payload.media)) {
    payload.media.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const kind = mediaKindFromEntry(entry);
      items.push({
        ...base,
        id: `${post.id}:media:${index}`,
        kind,
        title: entry.title || payload.title || post.text?.slice(0, 80) || 'Медиа',
        subtitle: entry.caption || entry.text || payload.desc || '',
        preview: makePreview(entry),
        accent: entry.accent || null,
        duration: entry.duration || null,
      });
    });
  }

  if (post.type === 'gallery' && Array.isArray(payload.slides)) {
    payload.slides.forEach((slide, index) => {
      if (!slide || typeof slide !== 'object') return;
      items.push({
        ...base,
        id: `${post.id}:slide:${index}`,
        kind: slide.url || slide.image ? 'photo' : 'card',
        title: slide.title || `Слайд ${index + 1}`,
        subtitle: slide.text || slide.caption || '',
        preview: makePreview(slide),
        accent: slide.accent || null,
        duration: slide.duration || null,
      });
    });
  }

  if (post.type === 'video') {
    items.push({
      ...base,
      id: `${post.id}:video`,
      kind: 'video',
      title: payload.title || post.text?.slice(0, 80) || 'Видео',
      subtitle: payload.desc || '',
      preview: makePreview(payload, 'linear-gradient(135deg, #7f8cff, #89d0ff 60%, #9de0c5)'),
      accent: payload.accent || null,
      duration: payload.duration || null,
    });
  }

  if (post.type === 'link' || post.type === 'repost') {
    items.push({
      ...base,
      id: `${post.id}:card`,
      kind: 'card',
      title: payload.title || payload.innerTitle || post.text?.slice(0, 80) || 'Карточка',
      subtitle: payload.desc || payload.innerDesc || '',
      preview: makePreview(payload, 'linear-gradient(135deg, #ff9fb1, #ffc88f 55%, #ffe8a6)'),
      accent: payload.accent || null,
      duration: null,
    });
  }

  return items;
}

export function collectUserMedia(posts, currentUserId = null) {
  const allItems = (Array.isArray(posts) ? posts : []).flatMap((post) => extractMediaItemsFromPost(post, currentUserId));
  const counts = {
    all: allItems.length,
    photos: allItems.filter((item) => item.kind === 'photo').length,
    videos: allItems.filter((item) => item.kind === 'video').length,
    cards: allItems.filter((item) => item.kind === 'card').length,
  };

  return {
    items: allItems,
    counts,
  };
}

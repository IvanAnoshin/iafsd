const STORY_TONES = ['violet', 'mint', 'blue', 'rose', 'gold', 'slate'];

export function getStoryTone(seed = '') {
  const key = String(seed || 'story');
  let acc = 0;
  for (let i = 0; i < key.length; i += 1) acc = (acc + key.charCodeAt(i) * (i + 3)) % 997;
  return STORY_TONES[acc % STORY_TONES.length] || 'violet';
}

export function getStoryInitials(label = '') {
  const parts = String(label || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'ST';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

export function buildStoriesHref({
  source = 'feed',
  mode = 'viewer',
  userId = null,
  storyId = null,
  itemId = null,
  name = '',
  title = '',
  chatId = null,
  deepLink = '',
} = {}) {
  const direct = String(deepLink || '').trim();
  if (direct.startsWith('/stories')) return direct;
  const params = new URLSearchParams();
  params.set('source', String(source || 'feed'));
  params.set('mode', String(mode || 'viewer'));
  if (userId !== null && userId !== undefined && userId !== '') params.set('user', String(userId));
  if (storyId) params.set('story', String(storyId));
  if (itemId) params.set('item', String(itemId));
  if (chatId) params.set('chat', String(chatId));
  if (name) params.set('name', String(name));
  if (title) params.set('title', String(title));
  return `/stories?${params.toString()}`;
}


export function mapStoryToRailItem(story, source = 'feed') {
  if (!story?.id) return null;
  const label = story.author?.name || 'Момент';
  return {
    id: String(story.id),
    label,
    meta: story.seen ? 'просмотрено' : 'новое',
    initials: getStoryInitials(label),
    tone: story.author?.tone || getStoryTone(story.author?.id || story.id || label),
    seen: Boolean(story.seen),
    userId: story.author?.id || null,
    storyId: story.id,
    source,
    mode: 'viewer',
    title: story.title || `Момент ${label}`,
    deepLink: story.deep_link || buildStoriesHref({
      source,
      mode: 'viewer',
      userId: story.author?.id || null,
      storyId: story.id,
      name: label,
      title: story.title || `Момент ${label}`,
    }),
  };
}

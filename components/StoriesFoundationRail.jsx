'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { buildStoriesHref, getStoryInitials, getStoryTone } from '@/lib/stories-foundation';

function StoryPlusIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>;
}

function StoryRing(props) {
  const { item, onSelect, compact = false } = props;
  const label = item.label || 'Момент';
  const initials = item.initials || getStoryInitials(label);
  const tone = item.tone || getStoryTone(item.id || label);
  const visual = item.kind === 'add' ? 'add' : 'person';
  return (
    <button type="button" className={`storyPrep-item ${item.seen ? 'is-seen' : ''} ${item.kind === 'add' ? 'is-add' : ''}`} onClick={() => onSelect(item)}>
      <span className={`storyPrep-ring is-${tone}`}>
        <span className={`storyPrep-core is-${visual}`}>
          {visual === 'add' ? <StoryPlusIcon /> : <span>{initials}</span>}
        </span>
      </span>
      <span className="storyPrep-label">{label}</span>
      {!compact && item.meta ? <span className="storyPrep-meta">{item.meta}</span> : null}
    </button>
  );
}

export default function StoriesFoundationRail({
  title = 'Моменты',
  subtitle = 'Короткие фото и видео друзей прямо в ленте.',
  items = [],
  showCreateRing = true,
  createLabel = 'Создать',
  createMeta = 'камера',
  source = 'feed',
  compact = false,
  onCreate,
  onSelect,
}) {
  const router = useRouter();

  const visibleItems = useMemo(() => {
    const nextItems = Array.isArray(items) ? items.filter((item) => item && item.kind !== 'add' && item.is_renderable !== false) : [];
    if (!showCreateRing) return nextItems;
    return [{
      id: '__create__',
      kind: 'add',
      label: createLabel || 'Создать',
      meta: createMeta || 'камера',
      source,
    }, ...nextItems];
  }, [createLabel, createMeta, items, showCreateRing, source]);

  const handleSelect = (item) => {
    if (item.kind === 'add') {
      if (typeof onCreate === 'function') {
        onCreate(item);
        return;
      }
      router.push(buildStoriesHref({
        source: item.source || source,
        mode: 'create',
        title: 'Создать момент',
      }));
      return;
    }
    if (typeof onSelect === 'function') {
      onSelect(item);
      return;
    }
    router.push(item.href || buildStoriesHref({
      source: item.source || source || 'feed',
      mode: 'viewer',
      userId: item.userId,
      storyId: item.storyId,
      itemId: item.itemId,
      name: item.label,
      title: item.title,
      chatId: item.chatId,
      deepLink: item.deepLink,
    }));
  };

  return (
    <section className={`storyPrep-card ${compact ? 'is-compact' : ''}`}>
      {(!compact || title || subtitle) ? (
        <div className="storyPrep-head">
          <div>
            {title ? <div className="storyPrep-title">{title}</div> : null}
            {subtitle ? <div className="storyPrep-subtitle">{subtitle}</div> : null}
          </div>
        </div>
      ) : null}
      <div className="storyPrep-row" aria-label={title}>
        {visibleItems.map((item) => <StoryRing key={item.id} item={item} onSelect={handleSelect} compact={compact} />)}
      </div>
    </section>
  );
}

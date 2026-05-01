'use client';

import { sanitizeUrlForClient } from '@/lib/url-safety';

function formatName(author) {
  const first = author?.first_name ?? author?.firstName ?? '';
  const last = author?.last_name ?? author?.lastName ?? '';
  return `${first} ${last}`.trim() || 'Пользователь';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeMediaItem(item, index = 0) {
  if (!item || typeof item !== 'object') return null;
  const rawKind = String(item.kind || item.type || '').trim().toLowerCase();
  const mime = String(item.mime || '').trim().toLowerCase();
  const kind = rawKind === 'video' || mime.startsWith('video/') ? 'video' : 'image';
  const url = sanitizeUrlForClient(item.url || item.mediaUrl || '');
  const thumbUrl = sanitizeUrlForClient(item.thumbUrl || item.thumb_url || item.thumbnailUrl || item.previewUrl || item.url || item.mediaUrl || '');
  if (!url && !thumbUrl) return null;
  return {
    id: item.id || item.mediaId || item.storageKey || item.storage_key || `${kind}-${index}`,
    kind,
    url,
    thumbUrl: thumbUrl || url,
    originalName: String(item.originalName || item.original_name || '').trim(),
  };
}

function getMedia(post) {
  const payload = post?.payload && typeof post.payload === 'object' ? post.payload : {};
  return Array.isArray(payload.media) ? payload.media.map(normalizeMediaItem).filter(Boolean) : [];
}

export default function PostRepostPreview({ post, unavailableLabel = 'Оригинальная публикация недоступна' }) {
  if (!post) {
    return (
      <div className="fsRepostPreview fsRepostPreview-unavailable">
        <strong>{unavailableLabel}</strong>
        <span>Пост мог быть удалён, скрыт или ограничен настройками приватности.</span>
      </div>
    );
  }

  const payload = post.payload && typeof post.payload === 'object' ? post.payload : {};
  const rawText = String(post.text || '').trim();
  const text = rawText && rawText !== 'Медиа' ? rawText : '';
  const media = getMedia(post);
  const visibleMedia = media.slice(0, 4);
  const extraMedia = Math.max(0, media.length - visibleMedia.length);
  const href = `/feed?post=${post.id}`;

  return (
    <a className="fsRepostPreview" href={href} aria-label="Открыть оригинальную публикацию">
      <div className="fsRepostPreview-head">
        <span className="fsRepostPreview-avatar">{String(formatName(post.author)).charAt(0) || 'П'}</span>
        <span className="fsRepostPreview-author">
          <strong>{formatName(post.author)}</strong>
          <small>{formatDate(post.created_at)}{post.community?.name ? ` · ${post.community.name}` : ''}</small>
        </span>
      </div>

      {text ? <div className="fsRepostPreview-text">{text}</div> : null}

      {visibleMedia.length ? (
        <div className={`fsRepostPreview-mediaGrid count-${Math.min(visibleMedia.length, 4)}`}>
          {visibleMedia.map((item, index) => (
            <span key={`${post.id}-${item.id}-${index}`} className={`fsRepostPreview-media ${item.kind === 'video' ? 'is-video' : ''}`}>
              {item.kind === 'video' ? (
                <video src={item.url} poster={item.thumbUrl || undefined} preload="metadata" muted playsInline />
              ) : (
                <img src={item.thumbUrl || item.url} alt={item.originalName || 'Медиа оригинального поста'} loading="lazy" />
              )}
              {item.kind === 'video' ? <i aria-hidden="true">▶</i> : null}
              {extraMedia > 0 && index === visibleMedia.length - 1 ? <b aria-hidden="true">+{extraMedia}</b> : null}
            </span>
          ))}
        </div>
      ) : null}

      {!text && !visibleMedia.length && (payload.title || payload.desc) ? (
        <div className="fsRepostPreview-text">{payload.title || payload.desc}</div>
      ) : null}

    </a>
  );
}

'use client';

import { useState } from 'react';

function formatDateTime(value) {
  if (!value) return 'Только что';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Только что';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ProfilePostCardLegacyOther({ post, profile, postsBusyKey, onToggleLike, onReport }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText?.(post.text || '');
    } finally {
      closeMenu();
    }
  };

  const handleReport = async () => {
    closeMenu();
    await onReport?.(post.id);
  };

  return (
    <article className="feed-post-card" onClick={() => menuOpen && setMenuOpen(false)}>
      <div className="feed-post-header">
        <div className="feed-post-user">
          <div className={`feed-post-avatar is-${profile.tone || 'violet'}`}>{profile.initials || profile.name?.charAt(0) || 'F'}</div>
          <div className="feed-post-user-info">
            <div className="feed-post-name">{profile.name}</div>
            <div className="feed-post-meta">{formatDateTime(post.created_at)}{post.location ? ` · ${post.location}` : ''}</div>
          </div>
        </div>

        <div className={`feed-post-menu-wrap ${menuOpen ? 'open' : ''}`} onClick={(event) => event.stopPropagation()}>
          <button className="feed-post-menu" type="button" aria-label="Меню поста" onClick={() => setMenuOpen((prev) => !prev)}>
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5"></circle>
              <circle cx="12" cy="12" r="1.5"></circle>
              <circle cx="12" cy="19" r="1.5"></circle>
            </svg>
          </button>
          <div className="feed-post-menu-dropdown">
            <button className="feed-post-menu-btn" type="button" onClick={handleCopy}>Скопировать</button>
            <button className="feed-post-menu-btn" type="button" onClick={handleReport}>Пожаловаться</button>
          </div>
        </div>
      </div>

      <div className="feed-post-text-wrap">
        <div className="feed-post-text">{post.text}</div>
      </div>

      <div className="feed-post-footer">
        <div className="feed-post-rating">
          <div className="vote-group">
            <button
              className={`vote-btn plus ${post.current_vote === 1 ? 'active' : ''}`}
              type="button"
              aria-label={post.is_liked ? 'Убрать лайк' : 'Нравится'}
              disabled={postsBusyKey === `like:${post.id}`}
              onClick={() => onToggleLike(post)}
            >
              <svg viewBox="0 0 24 24"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
            </button>
            <div className="vote-count">{post.stats.plus}</div>
          </div>
          <div className="vote-group"><div className="vote-count vote-count-minus">{post.stats.minus}</div></div>
        </div>
        <div className="feed-post-social">
          <button
            className={`social-btn like-btn ${post.is_liked ? 'active' : ''}`}
            type="button"
            disabled={postsBusyKey === `like:${post.id}`}
            onClick={() => onToggleLike(post)}
          >
            <svg viewBox="0 0 24 24"><path d="m12 20-1.1-1C6.14 14.24 3 11.39 3 7.86A4.86 4.86 0 0 1 7.86 3c1.76 0 3.45.82 4.14 2.09A4.83 4.83 0 0 1 16.14 3 4.86 4.86 0 0 1 21 7.86c0 3.53-3.14 6.38-7.9 11.13L12 20z"></path></svg>
            <span>{post.is_liked ? 'Нравится' : 'Лайк'}</span>
          </button>
          <div className="views-chip"><span>{post.stats.comments} комм.</span></div>
          <button className="social-btn save-btn" type="button" onClick={handleReport}>
            <svg viewBox="0 0 24 24"><path d="M4 12h16"></path><path d="m12 4 8 8-8 8"></path></svg>
            <span>Пожаловаться</span>
          </button>
        </div>
      </div>
    </article>
  );
}

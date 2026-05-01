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

function formatAuthorName(author) {
  return `${author?.first_name || ''} ${author?.last_name || ''}`.trim() || 'Пользователь';
}

export default function ProfilePostCardLegacySelf({
  post,
  ownTone,
  ownInitial,
  ownName,
  onVote,
  onToggleLike,
  onToggleSave,
  onAddComment,
  onCommentVote,
  onCommentEdit,
  onCommentDelete,
  onDelete,
  onReport,
  actionBusyKey,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const authorName = formatAuthorName(post.author) || ownName;
  const authorInitial = post.author?.first_name?.charAt(0)?.toUpperCase() || ownInitial;

  const closeMenu = () => setMenuOpen(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText?.(post.text || '');
    } finally {
      closeMenu();
    }
  };

  const handleDelete = async () => {
    closeMenu();
    await onDelete(post.id);
  };

  const handleReport = async () => {
    closeMenu();
    await onReport?.(post.id);
  };

  const submitComment = async () => {
    const text = commentText.trim();
    if (!text) return;
    const ok = await onAddComment(post.id, text);
    if (ok) setCommentText('');
  };

  return (
    <article className="feed-post-card" onClick={() => menuOpen && setMenuOpen(false)}>
      <div className="feed-post-header">
        <div className="feed-post-user">
          <div className={`feed-post-avatar is-${ownTone || 'violet'}`}>{authorInitial}</div>
          <div className="feed-post-user-info">
            <div className="feed-post-name">{authorName}</div>
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
            <button className="feed-post-menu-btn" type="button" onClick={handleDelete} disabled={actionBusyKey === `delete:${post.id}`}>Удалить</button>
            <button className="feed-post-menu-btn" type="button" onClick={handleReport}>Пожаловаться</button>
          </div>
        </div>
      </div>

      <div className="feed-post-text-wrap">
        <div className={`feed-post-text ${expanded ? '' : 'collapsed'}`}>{post.text}</div>
        {post.text?.length > 160 ? (
          <button className="feed-post-more-btn" type="button" onClick={() => setExpanded((prev) => !prev)}>
            {expanded ? 'Скрыть' : 'Ещё'}
          </button>
        ) : null}
      </div>

      <div className="feed-post-footer">
        <div className="feed-post-rating">
          <div className="vote-group">
            <button
              className={`vote-btn plus ${post.current_vote === 1 ? 'active' : ''}`}
              type="button"
              aria-label="Плюс"
              disabled={actionBusyKey === `vote:${post.id}`}
              onClick={() => onVote(post.id, post.current_vote === 1 ? 0 : 1)}
            >
              <svg viewBox="0 0 24 24"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
            </button>
            <div className="vote-count">{post.stats.plus}</div>
          </div>

          <div className="vote-group">
            <button
              className={`vote-btn minus ${post.current_vote === -1 ? 'active' : ''}`}
              type="button"
              aria-label="Минус"
              disabled={actionBusyKey === `vote:${post.id}`}
              onClick={() => onVote(post.id, post.current_vote === -1 ? 0 : -1)}
            >
              <svg viewBox="0 0 24 24"><path d="M5 12h14"></path></svg>
            </button>
            <div className="vote-count vote-count-minus">{post.stats.minus}</div>
          </div>
        </div>

        <div className="feed-post-social">
          <button className={`social-btn like-btn ${post.is_liked ? 'active' : ''}`} type="button" disabled={actionBusyKey === `like:${post.id}` || actionBusyKey === `vote:${post.id}`} onClick={() => onToggleLike(post)}>
            <svg viewBox="0 0 24 24"><path d="m12 20-1.1-1C6.14 14.24 3 11.39 3 7.86A4.86 4.86 0 0 1 7.86 3c1.76 0 3.45.82 4.14 2.09A4.83 4.83 0 0 1 16.14 3 4.86 4.86 0 0 1 21 7.86c0 3.53-3.14 6.38-7.9 11.13L12 20z"></path></svg>
            <span>{post.is_liked ? 'Нравится' : 'Лайк'}</span>
          </button>

          <button className="social-btn" type="button" onClick={() => setCommentsOpen(true)}>
            <svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.53-.29-3.62-.8L3 21l1.92-5.38A8.47 8.47 0 0 1 4 11.5 8.5 8.5 0 1 1 21 11.5z"></path></svg>
            <span>{post.stats.comments}</span>
          </button>

          <button className={`social-btn save-btn ${post.is_saved ? 'active' : ''}`} type="button" disabled={actionBusyKey === `save:${post.id}`} onClick={() => onToggleSave(post.id)}>
            <svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"></path></svg>
            <span>{post.is_saved ? 'Сохранено' : 'Сохранить'}</span>
          </button>
        </div>
      </div>

      <div className={`comment-overlay ${commentsOpen ? 'open' : ''}`} onClick={() => setCommentsOpen(false)}></div>

      <section className={`comment-sheet ${commentsOpen ? 'open' : ''}`} aria-hidden={!commentsOpen}>
        <div className="comment-sheet-handle"></div>

        <div className="comment-composer">
          <button className="comment-composer-btn" type="button" aria-label="Прикрепить файл" disabled>
            <svg viewBox="0 0 24 24"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.48-8.48"></path></svg>
          </button>

          <input
            className="comment-composer-input"
            type="text"
            placeholder="Напишите комментарий..."
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitComment();
              }
            }}
          />

          <button className="comment-composer-btn" type="button" aria-label="Отправить" onClick={submitComment}>
            <svg viewBox="0 0 24 24"><path d="M4 12h12"></path><path d="M12 6l6 6-6 6"></path></svg>
          </button>
        </div>

        <div className="comment-list">
          {post.comments?.length ? post.comments.map((comment) => (
            <div className="comment-item" key={comment.id}>
              <div className="comment-layout">
                <div className="comment-avatar"></div>
                <div className="comment-main">
                  <div className="comment-top">
                    <div className="comment-name">{formatAuthorName(comment.author)}</div>
                  </div>
                  <div className="comment-text">{comment.text}</div>
                  <div className="comment-bottom-row">
                    <div className="comment-bottom-left">
                      <div className="comment-time">{formatDateTime(comment.created_at)}{comment.edited ? ' · изменено' : ''}</div>
                      <div className="comment-reaction-group">
                        <button
                          className={`comment-reaction-btn plus ${comment.current_vote === 1 ? 'active' : ''}`}
                          type="button"
                          aria-label="Плюс комментарию"
                          disabled={actionBusyKey === `comment-vote:${comment.id}`}
                          onClick={() => onCommentVote(comment.id, comment.current_vote === 1 ? 0 : 1)}
                        >
                          <svg viewBox="0 0 24 24"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
                        </button>
                        <span className="comment-time">{comment.stats?.plus || 0}</span>
                      </div>
                      <div className="comment-reaction-group">
                        <button
                          className={`comment-reaction-btn minus ${comment.current_vote === -1 ? 'active' : ''}`}
                          type="button"
                          aria-label="Минус комментарию"
                          disabled={actionBusyKey === `comment-vote:${comment.id}`}
                          onClick={() => onCommentVote(comment.id, comment.current_vote === -1 ? 0 : -1)}
                        >
                          <svg viewBox="0 0 24 24"><path d="M5 12h14"></path></svg>
                        </button>
                        <span className="comment-time">{comment.stats?.minus || 0}</span>
                      </div>
                    </div>
                    {comment.is_mine ? (
                      <div className="comment-actions">
                        <button className="comment-reply-btn" type="button" onClick={() => onCommentEdit(comment)} disabled={actionBusyKey === `comment-edit:${comment.id}`}>Изменить</button>
                        <button className="comment-reply-btn" type="button" onClick={() => onCommentDelete(comment)} disabled={actionBusyKey === `comment-delete:${comment.id}`}>Удалить</button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          )) : <div className="profileView-list-empty">Пока без комментариев.</div>}
        </div>
      </section>
    </article>
  );
}

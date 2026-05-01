'use client';

import { useMemo, useState } from 'react';

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

function summarizePayload(payload = {}) {
  const galleryCount = Array.isArray(payload.gallery) ? payload.gallery.length : Array.isArray(payload.slides) ? payload.slides.length : 0;
  const mediaCount = Array.isArray(payload.media) ? payload.media.length : 0;
  const chips = [];

  if (galleryCount) chips.push(`${galleryCount} фото`);
  if (mediaCount) chips.push(`${mediaCount} вложений`);
  if (payload.video) chips.push('видео');
  if (payload.link) chips.push('ссылка');
  if (payload.repost) chips.push('репост');
  return chips.slice(0, 3);
}

function CommentActions({ comment, busyKey, onCommentVote, onCommentEdit, onCommentDelete }) {
  return (
    <div className="profileClean-commentActions">
      <button
        type="button"
        className={`profileClean-reactionBtn ${comment.current_vote === 1 ? 'is-active' : ''}`}
        disabled={busyKey === `comment-vote:${comment.id}`}
        onClick={() => onCommentVote?.(comment.id, comment.current_vote === 1 ? 0 : 1)}
      >
        + {comment.stats?.plus || 0}
      </button>
      <button
        type="button"
        className={`profileClean-reactionBtn is-negative ${comment.current_vote === -1 ? 'is-active' : ''}`}
        disabled={busyKey === `comment-vote:${comment.id}`}
        onClick={() => onCommentVote?.(comment.id, comment.current_vote === -1 ? 0 : -1)}
      >
        − {comment.stats?.minus || 0}
      </button>
      {comment.is_mine ? (
        <>
          <button type="button" className="profileClean-textAction" disabled={busyKey === `comment-edit:${comment.id}`} onClick={() => onCommentEdit?.(comment)}>Изменить</button>
          <button type="button" className="profileClean-textAction is-danger" disabled={busyKey === `comment-delete:${comment.id}`} onClick={() => onCommentDelete?.(comment)}>Удалить</button>
        </>
      ) : null}
    </div>
  );
}

export default function ProfilePostCardClean({
  post,
  authorName,
  authorHandle,
  authorInitial,
  tone = 'violet',
  showAuthor = false,
  allowDelete = false,
  allowSave = false,
  busyKey = '',
  onToggleLike,
  onToggleSave,
  onAddComment,
  onCommentVote,
  onCommentEdit,
  onCommentDelete,
  onDelete,
}) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const contentChips = useMemo(() => summarizePayload(post.payload || {}), [post.payload]);

  const submitComment = async () => {
    const text = commentText.trim();
    if (!text || !onAddComment) return;
    const ok = await onAddComment(post.id, text);
    if (ok) setCommentText('');
  };

  return (
    <article className="profileClean-card profileClean-postCard">
      <div className="profileClean-postTop">
        {showAuthor ? (
          <div className="profileClean-postAuthor">
            <div className={`profileClean-postAvatar is-${tone}`}>{authorInitial}</div>
            <div className="profileClean-postAuthorMeta">
              <div className="profileClean-postAuthorName">{authorName}</div>
              {authorHandle ? <div className="profileClean-postAuthorHandle">{authorHandle}</div> : null}
            </div>
          </div>
        ) : (
          <div className="profileClean-postLabel">Публикация профиля</div>
        )}
        <div className="profileClean-postDate">{formatDateTime(post.created_at)}</div>
      </div>

      <div className="profileClean-postBody">
        <p className="profileClean-postText">{post.text}</p>
        {contentChips.length ? (
          <div className="profileClean-chipRow is-tight">
            {contentChips.map((chip) => <span className="profileClean-chip" key={chip}>{chip}</span>)}
          </div>
        ) : null}
      </div>

      <div className="profileClean-postStats">
        <span>Рейтинг +{post.stats.plus} / −{post.stats.minus}</span>
        <span>{post.stats.comments} комм.</span>
        <span>{post.stats.saves} сохр.</span>
        <span>{post.stats.views} просмотров</span>
      </div>

      <div className="profileClean-postActions">
        <button
          type="button"
          className={`profileClean-actionBtn ${post.is_liked ? 'is-active' : ''}`}
          disabled={busyKey === `like:${post.id}`}
          onClick={() => onToggleLike?.(post)}
        >
          {post.is_liked ? 'Нравится' : 'Лайк'}
        </button>
        <button type="button" className={`profileClean-actionBtn ${commentsOpen ? 'is-active' : ''}`} onClick={() => setCommentsOpen((prev) => !prev)}>
          Комментарии
        </button>
        {allowSave ? (
          <button
            type="button"
            className={`profileClean-actionBtn ${post.is_saved ? 'is-active' : ''}`}
            disabled={busyKey === `save:${post.id}`}
            onClick={() => onToggleSave?.(post.id)}
          >
            {post.is_saved ? 'Сохранено' : 'Сохранить'}
          </button>
        ) : null}
        {allowDelete ? (
          <button type="button" className="profileClean-actionBtn is-danger" disabled={busyKey === `delete:${post.id}`} onClick={() => onDelete?.(post.id)}>
            Удалить
          </button>
        ) : null}
      </div>

      {commentsOpen ? (
        <div className="profileClean-commentsBox">
          {onAddComment ? (
            <div className="profileClean-commentComposer">
              <input
                className="profileClean-commentInput"
                type="text"
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder="Написать комментарий…"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitComment();
                  }
                }}
              />
              <button type="button" className="profileClean-submitBtn" onClick={submitComment}>Отправить</button>
            </div>
          ) : null}

          <div className="profileClean-commentsList">
            {post.comments?.length ? post.comments.map((comment) => (
              <div className="profileClean-commentItem" key={comment.id}>
                <div className="profileClean-commentTop">
                  <div>
                    <div className="profileClean-commentAuthor">{`${comment.author?.first_name || ''} ${comment.author?.last_name || ''}`.trim() || 'Пользователь'}</div>
                    <div className="profileClean-commentDate">{formatDateTime(comment.created_at)}{comment.edited ? ' · изменено' : ''}</div>
                  </div>
                  <CommentActions
                    comment={comment}
                    busyKey={busyKey}
                    onCommentVote={onCommentVote}
                    onCommentEdit={onCommentEdit}
                    onCommentDelete={onCommentDelete}
                  />
                </div>
                <div className="profileClean-commentText">{comment.text}</div>
              </div>
            )) : <div className="profileClean-emptyState is-compact">Пока без комментариев.</div>}
          </div>
        </div>
      ) : null}
    </article>
  );
}

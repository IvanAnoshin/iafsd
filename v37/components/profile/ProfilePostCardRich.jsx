'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildCommentThreadData, formatCommentAuthorName, getCollapsedCommentText, getCommentAuthorInitial, getCommentModerationHint, getCommentModerationLabel, getCommentModerationTone, getCommentReplyTarget, getCommentRootId, getCommentSocialSignals, getCommentSortLabel, getCommentThreadToggleLabel, getRemainingCommentThreadCount, isCommentTextLong, isCommentVisible, normalizeCommentDraft, sortCommentThreads } from '@/lib/comments-client';

const PROFILE_COMMENT_DRAFT_KEY_PREFIX = 'friendscape:profile-comment-draft:';

function getProfileCommentDraftKey(postId) {
  return `${PROFILE_COMMENT_DRAFT_KEY_PREFIX}${Number(postId || 0)}`;
}

function readProfileCommentDraft(postId) {
  if (typeof window === 'undefined') return '';
  try {
    return String(window.localStorage.getItem(getProfileCommentDraftKey(postId)) || '');
  } catch {
    return '';
  }
}

function writeProfileCommentDraft(postId, value) {
  if (typeof window === 'undefined') return;
  try {
    const normalized = String(value || '');
    if (normalized.trim()) window.localStorage.setItem(getProfileCommentDraftKey(postId), normalized);
    else window.localStorage.removeItem(getProfileCommentDraftKey(postId));
  } catch {}
}

function clearProfileCommentDraft(postId) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getProfileCommentDraftKey(postId));
  } catch {}
}

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

function formatName(authorName, fallback) {
  return authorName || fallback || 'Пользователь';
}

function buildCommentText(text) {
  return normalizeCommentDraft(text);
}

function getCommentLikeCount(comment) {
  return Number(comment?.stats?.plus || 0);
}

function getCommentScoreLabel(comment) {
  const minus = Number(comment?.stats?.minus || 0);
  return minus > 0 ? `Спорно · −${minus}` : '';
}

function getCommentMeta(comment) {
  return `${formatDateTime(comment.created_at)}${comment.edited ? ' · изм.' : ''}`;
}

function getCommentReplyLabel(comment) {
  const author = formatCommentAuthorName(comment?.author || null);
  return author ? `Ответ ${author}` : 'Ответ';
}

function getSlides(post) {
  const payload = post?.payload || {};
  if (Array.isArray(payload.slides)) return payload.slides;
  if (Array.isArray(payload.gallery)) {
    return payload.gallery.map((item, index) => ({
      bg: item?.preview || item?.background || item?.bg || 'linear-gradient(135deg, #b7c1ff, #95d7ff 55%, #afe5cc)',
      text: item?.title || item?.caption || item?.subtitle || `Фото ${index + 1}`,
    }));
  }
  if (Array.isArray(payload.media)) {
    const mediaSlides = payload.media
      .filter((item) => (item?.kind || 'photo') === 'photo')
      .map((item, index) => ({
        bg: item?.preview || item?.background || item?.bg || 'linear-gradient(135deg, #b7c1ff, #95d7ff 55%, #afe5cc)',
        text: item?.title || item?.caption || `Фото ${index + 1}`,
      }));
    return mediaSlides;
  }
  return [];
}

function getContentKind(post) {
  const payload = post?.payload || {};
  if (post?.type === 'video' || payload.video) return 'video';
  if (post?.type === 'link' || payload.link) return 'link';
  if (post?.type === 'repost' || payload.repost) return 'repost';
  if (getSlides(post).length) return 'gallery';
  return 'text';
}

function CommentMenu({ comment, busyKey, menuOpen, onToggle, onReply, onCopy, onCommentEdit, onCommentDelete, onCommentReport }) {
  return (
    <div className={`comment-menuWrap ${menuOpen ? 'open' : ''}`} onClick={(event) => event.stopPropagation()}>
      <button type="button" className="comment-menuBtn" aria-label="Действия с комментарием" onClick={() => onToggle?.(comment.id)}>⋯</button>
      <div className="comment-menuDropdown">
        {comment.moderation?.can_reply ? <button type="button" className="comment-menuItem" onClick={() => onReply?.(comment)}>Ответить</button> : null}
        {comment.moderation?.can_copy ? <button type="button" className="comment-menuItem" onClick={() => onCopy?.(comment)}>Скопировать</button> : null}
        {comment.moderation?.can_edit ? <button type="button" className="comment-menuItem" onClick={() => onCommentEdit?.(comment)} disabled={busyKey === `comment-edit:${comment.id}`}>Изменить</button> : null}
        {comment.moderation?.can_report ? <button type="button" className="comment-menuItem" onClick={() => onCommentReport?.(comment)} disabled={busyKey === `comment-report:${comment.id}`}>Пожаловаться</button> : null}
        {comment.moderation?.reported_by_me && !comment.moderation?.can_report ? <button type="button" className="comment-menuItem" disabled>Жалоба отправлена</button> : null}
        {comment.moderation?.can_delete ? <button type="button" className="comment-menuItem is-danger" onClick={() => onCommentDelete?.(comment)} disabled={busyKey === `comment-delete:${comment.id}`}>Удалить</button> : null}
      </div>
    </div>
  );
}

export default function ProfilePostCardRich({
  post,
  authorName,
  authorHandle,
  authorInitial,
  showAuthor = false,
  allowDelete = false,
  allowSave = false,
  busyKey = '',
  onVote,
  onToggleLike,
  onToggleSave,
  onAddComment,
  onCommentVote,
  onCommentEdit,
  onCommentDelete,
  onCommentReport,
  onDelete,
  onReport,
  onShare,
  onOpenAuthor,
}) {
  const [expanded, setExpanded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [commentText, setCommentText] = useState('');
  const [commentReplyTarget, setCommentReplyTarget] = useState(null);
  const [commentMenuId, setCommentMenuId] = useState(null);
  const [expandedCommentBodies, setExpandedCommentBodies] = useState({});
  const [expandedReplyRoots, setExpandedReplyRoots] = useState({});
  const [highlightedCommentId, setHighlightedCommentId] = useState(null);
  const [commentComposerError, setCommentComposerError] = useState('');
  const [commentSortMode, setCommentSortMode] = useState('activity');
  const [visibleCommentRoots, setVisibleCommentRoots] = useState(5);
  const highlightTimerRef = useRef(null);
  const commentTextareaRef = useRef(null);
  const [commentSlowState, setCommentSlowState] = useState(false);
  const payload = post.payload || {};
  const slides = useMemo(() => getSlides(post), [post]);
  const kind = useMemo(() => getContentKind(post), [post]);
  const { topLevelComments, repliesByRootId, byId: commentById } = useMemo(() => buildCommentThreadData(post.comments || []), [post.comments]);
  const sortedTopLevelComments = useMemo(() => sortCommentThreads(topLevelComments, repliesByRootId, commentSortMode, {
    postAuthorId: Number(post?.author?.id || 0),
  }), [commentSortMode, post?.author?.id, repliesByRootId, topLevelComments]);
  const visibleTopLevelComments = useMemo(() => sortedTopLevelComments.slice(0, visibleCommentRoots), [sortedTopLevelComments, visibleCommentRoots]);
  const remainingCommentThreads = useMemo(() => getRemainingCommentThreadCount(sortedTopLevelComments, visibleCommentRoots), [sortedTopLevelComments, visibleCommentRoots]);
  const hasCommentDraft = Boolean(String(commentText || '').trim());
  const isSubmittingComment = busyKey === `comment:${post.id}`;
  const commentComposerStateLabel = isSubmittingComment
    ? (commentSlowState ? 'Сеть медленная, всё ещё отправляем…' : 'Отправляем комментарий…')
    : commentComposerError
      ? 'Не отправилось'
      : hasCommentDraft
        ? 'Черновик сохранён'
        : '';

  useEffect(() => {
    if (!commentsOpen) return;
    setCommentComposerError('');
    setCommentText(readProfileCommentDraft(post.id));
    setCommentSortMode('activity');
    setVisibleCommentRoots(5);
    setExpandedCommentBodies({});
  }, [commentsOpen, post.id]);

  useEffect(() => {
    if (!commentsOpen) return;
    writeProfileCommentDraft(post.id, commentText);
  }, [commentsOpen, post.id, commentText]);

  useLayoutEffect(() => {
    const node = commentTextareaRef.current;
    if (!node) return;
    node.style.height = '0px';
    const nextHeight = Math.min(Math.max(node.scrollHeight, 42), 120);
    node.style.height = `${nextHeight}px`;
  }, [commentsOpen, commentText, commentReplyTarget]);

  useEffect(() => {
    if (!isSubmittingComment) {
      setCommentSlowState(false);
      return;
    }
    const timer = window.setTimeout(() => setCommentSlowState(true), 1800);
    return () => window.clearTimeout(timer);
  }, [isSubmittingComment]);

  const focusCommentById = (commentId) => {
    if (typeof document === 'undefined') return;
    const normalizedId = Number(commentId || 0);
    if (!normalizedId) return;
    const targetComment = commentById.get(normalizedId) || null;
    if (targetComment) {
      const rootId = getCommentRootId(targetComment, commentById);
      if (rootId && rootId !== normalizedId) {
        setExpandedReplyRoots((prev) => ({ ...prev, [rootId]: true }));
      }
    }
    setVisibleCommentRoots((prev) => Math.max(prev, sortedTopLevelComments.length || 0));
    window.requestAnimationFrame(() => {
      const node = document.querySelector(`[data-profile-comment-id="${normalizedId}"]`);
      if (!node) return;
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedCommentId(normalizedId);
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => setHighlightedCommentId((prev) => prev === normalizedId ? null : prev), 1800);
    });
  };

  const ensureThreadOpen = (comment) => {
    const rootId = getCommentRootId(comment, commentById);
    if (!rootId) return;
    setExpandedReplyRoots((prev) => ({ ...prev, [rootId]: true }));
  };

  const focusCommentComposer = () => {
    const node = commentTextareaRef.current;
    if (!node) return;
    node.focus();
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const submitComment = async () => {
    const text = buildCommentText(commentText);
    if (!text || !onAddComment) return;
    setCommentComposerError('');
    const ok = await onAddComment(post.id, { text, replyToCommentId: commentReplyTarget?.id || null });
    if (ok) {
      if (commentReplyTarget) ensureThreadOpen(commentReplyTarget);
      clearProfileCommentDraft(post.id);
      setCommentText('');
      setCommentReplyTarget(null);
      return;
    }
    setCommentComposerError('Не удалось отправить комментарий.');
  };

  const metaText = payload.meta || `${formatDateTime(post.created_at)}${post.location ? ` · ${post.location}` : ''}`;
  const canOpenAuthor = showAuthor && typeof onOpenAuthor === 'function';

  const handleCommentReply = (comment) => {
    if (!comment?.moderation?.can_reply) return;
    ensureThreadOpen(comment);
    setCommentReplyTarget(comment);
    setCommentMenuId(null);
    setCommentComposerError('');
  };

  const handleCommentCopy = async (comment) => {
    if (!comment?.moderation?.can_copy) return;
    const nextText = String(comment?.raw_text || comment?.text || '').trim();
    if (!nextText) return;
    try {
      await navigator.clipboard.writeText(nextText);
      setCommentMenuId(null);
    } catch {}
  };

  const renderCommentCard = (comment, nested = false) => {
    const canOpenCommentAuthor = typeof onOpenAuthor === 'function' && Number(comment.author?.id || 0) > 0;
    const likeActive = comment.current_vote === 1;
    const replyTarget = getCommentReplyTarget(comment, commentById);
    const isHighlighted = highlightedCommentId === comment.id;
    const moderationLabel = getCommentModerationLabel(comment);
    const moderationHint = getCommentModerationHint(comment);
    const isVisible = isCommentVisible(comment);
    const authorName = formatCommentAuthorName(comment.author);
    const canExpandText = isVisible && isCommentTextLong(comment.text);
    const textExpanded = Boolean(expandedCommentBodies[comment.id]);
    const commentBody = canExpandText && !textExpanded ? getCollapsedCommentText(comment.text) : comment.text;
    const replyCount = (repliesByRootId.get(Number(comment.id || 0)) || []).length;
    const socialSignals = getCommentSocialSignals(comment, {
      postAuthorId: Number(post?.author?.id || 0),
      replyCount,
    });

    const primarySignals = socialSignals.slice(0, 2);
    return (
      <article className={`comment-card comment-card-flat comment-card-inline ${nested ? 'comment-card-nested' : ''} ${isHighlighted ? 'comment-card-highlighted' : ''} ${isVisible ? '' : 'comment-card-moderated'}`} key={comment.id} data-profile-comment-id={comment.id}>
        <div className="comment-card-shell">
          {canOpenCommentAuthor ? (
            <button type="button" className="comment-avatar comment-avatar-btn" onClick={() => onOpenAuthor?.(comment.author || null)} aria-label="Открыть профиль автора комментария">{getCommentAuthorInitial(comment.author)}</button>
          ) : (
            <div className="comment-avatar comment-avatar-btn is-muted" aria-hidden="true">{getCommentAuthorInitial(comment.author)}</div>
          )}
          <div className="comment-content">
            <div className="comment-header">
              <div className="comment-headerMain">
                {canOpenCommentAuthor ? (
                  <button type="button" className="comment-author-row comment-author-btn" onClick={() => onOpenAuthor?.(comment.author || null)}>
                    <span className="comment-author-name">{authorName}</span>
                  </button>
                ) : (
                  <div className="comment-author-row">
                    <span className="comment-author-name">{authorName}</span>
                  </div>
                )}
                <div className="comment-headerMetaLine">
                  {replyTarget ? (
                    <button type="button" className="comment-inlineReply" onClick={() => focusCommentById(replyTarget.id)}>
                      {getCommentReplyLabel(replyTarget)}
                    </button>
                  ) : null}
                  <span className="comment-date">{getCommentMeta(comment)}</span>
                </div>
              </div>
              <CommentMenu
                comment={comment}
                busyKey={busyKey}
                menuOpen={commentMenuId === comment.id}
                onToggle={(commentId) => setCommentMenuId((prev) => prev === commentId ? null : commentId)}
                onReply={handleCommentReply}
                onCopy={handleCommentCopy}
                onCommentEdit={onCommentEdit}
                onCommentDelete={onCommentDelete}
                onCommentReport={onCommentReport}
              />
            </div>
            <div className={`comment-text ${isVisible ? '' : 'is-muted'} ${canExpandText && !textExpanded ? 'is-collapsed' : ''}`}>{commentBody}</div>
            {canExpandText ? (
              <button type="button" className="comment-expandBtn" onClick={() => setExpandedCommentBodies((prev) => ({ ...prev, [comment.id]: !prev[comment.id] }))}>
                {textExpanded ? 'Свернуть' : 'Читать полностью'}
              </button>
            ) : null}
            {replyTarget?.text ? (
              <button type="button" className="comment-replyReference comment-replyReference-inline" onClick={() => focusCommentById(replyTarget.id)}>
                <span className="comment-replyReferenceText">{replyTarget.text}</span>
              </button>
            ) : null}
            <div className="comment-footer">
              <div className="comment-footerMeta">
                {primarySignals.map((signal) => (
                  <span key={`${comment.id}-${signal.key}`} className={`comment-metaSignal is-${signal.tone}`}>{signal.label}</span>
                ))}
                {moderationLabel ? <span className={`comment-metaSignal is-${getCommentModerationTone(comment)}`}>{moderationLabel}</span> : null}
                {comment.moderation?.can_reply ? <button className="comment-linkBtn" type="button" onClick={() => handleCommentReply(comment)}>Ответить</button> : null}
                {moderationHint ? <span className="comment-moderationHint">{moderationHint}</span> : null}
              </div>
              {comment.moderation?.can_vote ? (
                <div className="comment-likeRow">
                  <button
                    className={`comment-likeBtn ${comment.current_vote === 1 ? 'active' : ''}`}
                    type="button"
                    onClick={() => onCommentVote?.(comment.id, comment.current_vote === 1 ? 0 : 1)}
                    disabled={busyKey === `comment-vote:${comment.id}`}
                  >
                    <svg viewBox="0 0 24 24"><path d="m12 20-1.1-1C6.14 14.24 3 11.39 3 7.86A4.86 4.86 0 0 1 7.86 3c1.76 0 3.45.82 4.14 2.09A4.83 4.83 0 0 1 16.14 3 4.86 4.86 0 0 1 21 7.86c0 3.53-3.14 6.38-7.9 11.13L12 20z"></path></svg>
                    <span className="comment-likeLabel">{getCommentLikeCount(comment)}</span>
                  </button>
                  {getCommentScoreLabel(comment) ? <span className="comment-likeMeta">{getCommentScoreLabel(comment)}</span> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <article className="feed-post-card profilePost-richCard">
      <div className="feed-post-header">
        {canOpenAuthor ? (
          <button type="button" className="feed-post-user feed-post-userBtn" onClick={() => onOpenAuthor?.(post.author || null)}>
            <div className="feed-post-avatar">{authorInitial || 'P'}</div>
            <div className="feed-post-user-info">
              <div className="feed-post-name">{formatName(authorName)}</div>
              <div className="feed-post-meta">{authorHandle ? `${authorHandle} · ${metaText}` : metaText}</div>
            </div>
          </button>
        ) : (
          <div className="feed-post-user">
            <div className="feed-post-avatar">{authorInitial || 'P'}</div>
            <div className="feed-post-user-info">
              <div className="feed-post-name">{showAuthor ? formatName(authorName) : 'Публикация профиля'}</div>
              <div className="feed-post-meta">{showAuthor && authorHandle ? `${authorHandle} · ${metaText}` : metaText}</div>
            </div>
          </div>
        )}

        <div className="profilePost-topActions">
          {onShare ? (
            <button type="button" className="profilePost-topActionBtn" onClick={() => onShare?.(post)}>Поделиться</button>
          ) : null}
          {onReport ? (
            <button type="button" className="profilePost-topActionBtn is-muted" onClick={() => onReport?.(post.id)}>Пожаловаться</button>
          ) : null}
          {allowDelete ? (
            <button type="button" className="profilePost-topDelete" disabled={busyKey === `delete:${post.id}`} onClick={() => onDelete?.(post.id)}>
              Удалить
            </button>
          ) : null}
        </div>
      </div>

      <div className="feed-post-text-wrap">
        <div className={`feed-post-text ${expanded ? '' : 'collapsed'}`}>{post.text}</div>
        {post.text?.length > 140 ? (
          <button className="feed-post-more-btn" type="button" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Скрыть' : 'Ещё'}</button>
        ) : null}
      </div>

      {kind === 'gallery' && slides.length ? (
        <div className="feed-post-content-block feed-post-gallery is-active">
          <div className="feed-post-gallery-track">
            {slides.length > 1 ? (
              <>
                <button className="feed-post-gallery-nav feed-post-gallery-prev" type="button" aria-label="Предыдущий слайд" onClick={() => setGalleryIndex((galleryIndex - 1 + slides.length) % slides.length)}>
                  <svg viewBox="0 0 24 24"><path d="M15 18 9 12l6-6"></path></svg>
                </button>
                <button className="feed-post-gallery-nav feed-post-gallery-next" type="button" aria-label="Следующий слайд" onClick={() => setGalleryIndex((galleryIndex + 1) % slides.length)}>
                  <svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"></path></svg>
                </button>
              </>
            ) : null}
            {slides.map((slide, index) => (
              <div key={`${post.id}-${index}`} className={`feed-post-slide ${index === galleryIndex ? 'active' : ''}`} style={{ backgroundImage: slide.bg }}>
                <span>{slide.text}</span>
              </div>
            ))}
          </div>
          {slides.length > 1 ? (
            <div className="feed-post-gallery-bottom">
              <div className="feed-post-gallery-dots">
                {slides.map((_, index) => (
                  <button key={index} className={`feed-post-gallery-dot ${index === galleryIndex ? 'active' : ''}`} type="button" onClick={() => setGalleryIndex(index)} />
                ))}
              </div>
              <div className="feed-post-gallery-counter">{galleryIndex + 1} / {slides.length}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {kind === 'video' ? (
        <div className="feed-post-content-block feed-post-video-card is-active">
          <div className="video-poster"><div className="play-btn" aria-hidden="true"></div></div>
          <div className="feed-post-video-title">{payload.title || 'Видео из профиля'}</div>
          <div className="feed-post-video-desc">{payload.desc || payload.caption || 'Видео сохранено в профиле пользователя.'}</div>
        </div>
      ) : null}

      {kind === 'link' ? (
        <div className="feed-post-content-block feed-post-link-card is-active">
          {payload.domain ? <div className="link-domain">{payload.domain}</div> : null}
          <div className="feed-post-link-title">{payload.title || 'Ссылка'}</div>
          <div className="feed-post-link-desc">{payload.desc || payload.subtitle || 'Материал со ссылкой.'}</div>
        </div>
      ) : null}

      {kind === 'repost' ? (
        <div className="feed-post-content-block feed-post-repost-card is-active">
          <div className="feed-post-repost-title">{payload.title || 'Репост'}</div>
          <div className="feed-post-repost-desc">{payload.desc || 'Подборка или репост из другого источника.'}</div>
          {(payload.innerTitle || payload.innerDesc) ? (
            <div className="repost-inner">
              <div className="feed-post-link-title">{payload.innerTitle || 'Внутренний материал'}</div>
              <div className="feed-post-link-desc">{payload.innerDesc || 'Краткое описание вложенного материала.'}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="feed-post-footer profilePost-richFooter">
        {onVote ? (
          <div className="feed-post-rating">
            <div className="vote-group">
              <button
                className={`vote-btn plus ${post.current_vote === 1 ? 'active' : ''}`}
                type="button"
                aria-label="Плюс"
                disabled={busyKey === `vote:${post.id}` || busyKey === `like:${post.id}`}
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
                disabled={busyKey === `vote:${post.id}` || busyKey === `like:${post.id}`}
                onClick={() => onVote(post.id, post.current_vote === -1 ? 0 : -1)}
              >
                <svg viewBox="0 0 24 24"><path d="M5 12h14"></path></svg>
              </button>
              <div className="vote-count vote-count-minus">{post.stats.minus}</div>
            </div>
          </div>
        ) : null}

        <div className="profilePost-metaStrip">
          <span>{post.stats.comments} комм.</span>
          <span>{post.stats.saves} сохр.</span>
          <span>{post.stats.views} просмотров</span>
          <span>{post.stats.reposts} репостов</span>
        </div>

        <div className="feed-post-social">
          <button className={`social-btn like-btn ${post.is_liked ? 'active' : ''}`} type="button" disabled={busyKey === `like:${post.id}` || busyKey === `vote:${post.id}`} onClick={() => onToggleLike?.(post)}>
            <svg viewBox="0 0 24 24"><path d="m12 20-1.1-1C6.14 14.24 3 11.39 3 7.86A4.86 4.86 0 0 1 7.86 3c1.76 0 3.45.82 4.14 2.09A4.83 4.83 0 0 1 16.14 3 4.86 4.86 0 0 1 21 7.86c0 3.53-3.14 6.38-7.9 11.13L12 20z"></path></svg>
            <span>{post.is_liked ? 'Нравится' : 'Лайк'}</span>
          </button>
          <button className={`social-btn comments-btn ${commentsOpen ? 'is-open' : ''}`} type="button" onClick={() => { setCommentsOpen((prev) => { const next = !prev; if (!next) { setCommentReplyTarget(null); setCommentMenuId(null); setCommentComposerError(''); } return next; }); }}>
            <svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.53-.29-3.62-.8L3 21l1.92-5.38A8.47 8.47 0 0 1 4 11.5 8.5 8.5 0 1 1 21 11.5z"></path></svg>
            <span>{commentsOpen ? 'Скрыть' : 'Комментарии'}</span>
          </button>
          {onShare ? (
            <button className="social-btn repost-btn" type="button" onClick={() => onShare?.(post)}>
              <svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14"></path><path d="M16 6l4 4-4 4"></path><path d="M20 10H9a5 5 0 0 0-5 5"></path></svg>
              <span>{post.stats.reposts}</span>
            </button>
          ) : null}
          {allowSave ? (
            <button className={`social-btn save-btn ${post.is_saved ? 'active' : ''}`} type="button" disabled={busyKey === `save:${post.id}`} onClick={() => onToggleSave?.(post.id)}>
              <svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"></path></svg>
              <span>{post.is_saved ? 'Сохранено' : 'Сохранить'}</span>
            </button>
          ) : null}
        </div>
      </div>

      {commentsOpen ? (
        <div className="profilePost-commentsInline" onClick={() => setCommentMenuId(null)}>
          {onAddComment ? (
            <div className="comment-composer comment-composer-flat profilePost-commentComposerInline">
              {commentReplyTarget ? (
                <div className="comment-replyBanner">
                  <div className="comment-replyBannerMain">
                    <div className="comment-replyBannerLabel">{getCommentReplyLabel(commentReplyTarget)}</div>
                    <button type="button" className="comment-replyBannerTextBtn" onClick={() => focusCommentById(commentReplyTarget.id)}>
                      <span className="comment-replyBannerText">{commentReplyTarget.text}</span>
                    </button>
                  </div>
                  <button type="button" className="comment-replyBannerClose" onClick={() => setCommentReplyTarget(null)} aria-label="Отменить ответ">×</button>
                </div>
              ) : null}
              <div className="comment-composerRow">
                <textarea
                  ref={commentTextareaRef}
                  className="comment-composer-input comment-input-flat"
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                  placeholder={commentReplyTarget ? 'Ответить' : 'Написать комментарий…'}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                      event.preventDefault();
                      submitComment();
                    }
                  }}
                  rows={1}
                />
                <button type="button" className="comment-composer-btn comment-composerSend profilePost-sendBtnInline" onClick={submitComment} disabled={isSubmittingComment || !buildCommentText(commentText)}>
                  <svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>
                </button>
              </div>
              <div className={`comment-composerMeta ${commentComposerError ? 'is-error' : commentSlowState ? 'is-warning' : hasCommentDraft ? 'is-draft' : ''}`}>
                <span className="comment-composerState">{commentComposerStateLabel || 'Напишите комментарий или ответьте в треде'}</span>
                {commentComposerError ? <button type="button" className="comment-composerMetaBtn" onClick={submitComment}>Повторить</button> : null}
              </div>
            </div>
          ) : null}
          <div className="comment-sheetControls profilePost-commentControls">
            <div className="comment-sortRow" role="tablist" aria-label="Сортировка комментариев">
              <button type="button" className={`comment-sortBtn ${commentSortMode === 'activity' ? 'active' : ''}`} onClick={() => setCommentSortMode('activity')}>Обсуждение</button>
              <button type="button" className={`comment-sortBtn ${commentSortMode === 'latest' ? 'active' : ''}`} onClick={() => setCommentSortMode('latest')}>Новые</button>
              <button type="button" className={`comment-sortBtn ${commentSortMode === 'popular' ? 'active' : ''}`} onClick={() => setCommentSortMode('popular')}>Популярные</button>
              <button type="button" className={`comment-sortBtn ${commentSortMode === 'author' ? 'active' : ''}`} onClick={() => setCommentSortMode('author')}>Автор</button>
            </div>
            <div className="comment-sheetNavRow">
              <span className="comment-sheetNavMeta">Порядок: {getCommentSortLabel(commentSortMode)}</span>
              <button type="button" className="comment-sheetNavBtn" onClick={focusCommentComposer}>К ответу</button>
            </div>
          </div>
          <div className="comment-list profilePost-commentListInline">
            {sortedTopLevelComments.length ? visibleTopLevelComments.map((comment) => {
              const rootId = Number(comment.id || 0);
              const replies = repliesByRootId.get(rootId) || [];
              const repliesExpanded = Boolean(expandedReplyRoots[rootId]);
              return (
                <div className="comment-threadGroup" key={comment.id}>
                  {renderCommentCard(comment)}
                  {replies.length ? (
                    <div className="comment-threadMeta">
                      <button type="button" className="comment-threadToggle" onClick={() => setExpandedReplyRoots((prev) => ({ ...prev, [rootId]: !prev[rootId] }))}>
                        {getCommentThreadToggleLabel(replies.length, repliesExpanded)}
                      </button>
                    </div>
                  ) : null}
                  {replies.length && repliesExpanded ? (
                    <div className="comment-threadChildren">
                      {replies.map((reply) => renderCommentCard(reply, true))}
                    </div>
                  ) : null}
                </div>
              );
            }) : (
              <div className="comment-stateCard comment-emptyState">
                <div className="comment-stateTitle">Пока без комментариев</div>
                <div className="comment-stateText">Оставьте первый комментарий, чтобы запустить обсуждение под этим постом.</div>
              </div>
            )}
            {remainingCommentThreads > 0 ? (
              <div className="comment-loadMoreRow">
                <button type="button" className="comment-loadMoreBtn" onClick={() => setVisibleCommentRoots((prev) => prev + 5)}>
                  Показать ещё {remainingCommentThreads}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

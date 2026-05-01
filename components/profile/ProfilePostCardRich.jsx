'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PostRepostPreview from '@/components/PostRepostPreview';
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


function safeStat(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatName(authorName, fallback) {
  return authorName || fallback || 'Пользователь';
}

function buildCommentText(text) {
  return normalizeCommentDraft(text);
}


function getCommentMeta(comment) {
  return `${formatDateTime(comment.created_at)}${comment.edited ? ' · изм.' : ''}`;
}

function getCommentReplyLabel(comment) {
  const author = formatCommentAuthorName(comment?.author || null);
  return author ? `Ответ ${author}` : 'Ответ';
}

function sanitizePostMediaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:') || lower.startsWith('file:')) return '';
  if (raw.startsWith('/')) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizePostMediaItem(item, index = 0) {
  if (!item || typeof item !== 'object') return null;
  const rawKind = String(item.kind || item.type || '').trim().toLowerCase();
  const mime = String(item.mime || '').trim().toLowerCase();
  const kind = rawKind === 'video' || mime.startsWith('video/') ? 'video' : 'image';
  const url = sanitizePostMediaUrl(item.url || item.mediaUrl);
  const thumbUrl = sanitizePostMediaUrl(item.thumbUrl || item.thumb_url || item.thumbnailUrl || item.previewUrl || item.url || item.mediaUrl);
  if (!url && !thumbUrl) return null;
  return {
    id: item.id || item.mediaId || item.storageKey || item.storage_key || `${kind}-${index}`,
    kind,
    url,
    thumbUrl: thumbUrl || url,
    originalName: String(item.originalName || item.original_name || '').trim(),
    width: Number(item.width || 0) || null,
    height: Number(item.height || 0) || null,
  };
}

function getPostMedia(post) {
  const payload = post?.payload || {};
  if (!Array.isArray(payload.media)) return [];
  return payload.media.map(normalizePostMediaItem).filter(Boolean);
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
  return [];
}

function getContentKind(post) {
  const payload = post?.payload || {};
  if (getPostMedia(post).length) return 'media';
  if (post?.type === 'video' || payload.video) return 'video';
  if (post?.type === 'link' || payload.link) return 'link';
  if (post?.type === 'repost' || payload.repost) return 'repost';
  if (getSlides(post).length) return 'gallery';
  return 'text';
}

function ProfilePostMediaBlock({ media, postId }) {
  if (!media.length) return null;
  const visible = media.slice(0, 4);
  const extraCount = Math.max(0, media.length - visible.length);
  return (
    <div className="profilePost-mediaBlock" aria-label="Медиа публикации">
      <div className={`profilePost-mediaGrid profilePost-mediaGrid-${Math.min(media.length, 4)}`}>
        {visible.map((item, index) => {
          const src = item.kind === 'video' ? item.url : item.thumbUrl || item.url;
          return (
            <a key={`${postId}-${item.id}-${index}`} className={`profilePost-mediaTile ${item.kind === 'video' ? 'is-video' : 'is-image'}`} href={item.url} target="_blank" rel="noreferrer" aria-label={item.kind === 'video' ? 'Открыть видео' : 'Открыть изображение'}>
              {item.kind === 'video' ? (
                <video src={item.url} poster={item.thumbUrl || undefined} preload="metadata" muted playsInline onError={(event) => { event.currentTarget.style.display = 'none'; }} />
              ) : (
                <img src={src} alt={item.originalName || 'Изображение публикации'} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
              )}
              {item.kind === 'video' ? <span className="profilePost-videoBadge">▶</span> : null}
              {extraCount > 0 && index === visible.length - 1 ? <span className="profilePost-extraBadge">+{extraCount}</span> : null}
              <span className="profilePost-mediaFallback">Медиа недоступно</span>
            </a>
          );
        })}
      </div>
    </div>
  );
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
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const highlightTimerRef = useRef(null);
  const commentTextareaRef = useRef(null);
  const [commentSlowState, setCommentSlowState] = useState(false);
  const payload = post.payload || {};
  const isRepost = Boolean(post?.repost_of);
  const mediaItems = useMemo(() => getPostMedia(post), [post]);
  const slides = useMemo(() => getSlides(post), [post]);
  const kind = useMemo(() => getContentKind(post), [post]);
  const postText = useMemo(() => {
    const value = String(post?.text || '').trim();
    if (mediaItems.length && value === 'Медиа') return '';
    return value;
  }, [mediaItems.length, post?.text]);
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

  const metaText = payload.meta || `${isRepost ? 'репостнул · ' : ''}${formatDateTime(post.created_at)}${post.location ? ` · ${post.location}` : ''}`;
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
                <div className="comment-voteRow" aria-label="Оценка комментария">
                  <button
                    className={`comment-voteBtn is-plus ${comment.current_vote === 1 ? 'active' : ''}`}
                    type="button"
                    aria-label="Поставить плюс комментарию"
                    onClick={() => onCommentVote?.(comment.id, comment.current_vote === 1 ? 0 : 1)}
                    disabled={busyKey === `comment-vote:${comment.id}`}
                  >
                    <svg viewBox="0 0 24 24"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
                    <span>{safeStat(comment?.stats?.plus)}</span>
                  </button>
                  <button
                    className={`comment-voteBtn is-minus ${comment.current_vote === -1 ? 'active' : ''}`}
                    type="button"
                    aria-label="Поставить минус комментарию"
                    onClick={() => onCommentVote?.(comment.id, comment.current_vote === -1 ? 0 : -1)}
                    disabled={busyKey === `comment-vote:${comment.id}`}
                  >
                    <svg viewBox="0 0 24 24"><path d="M5 12h14"></path></svg>
                    <span>{safeStat(comment?.stats?.minus)}</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <article className={`feed-post-card profilePost-richCard fsPost-card ${isRepost ? 'fsPost-card-repost' : ''}`} onClick={() => postMenuOpen && setPostMenuOpen(false)}>
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

        <div className={`feed-post-menu-wrap fsPost-menu ${postMenuOpen ? 'open' : ''}`} onClick={(event) => event.stopPropagation()}>
          <button className="feed-post-menu" type="button" aria-label="Меню поста" onClick={() => setPostMenuOpen((value) => !value)}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg>
          </button>
          <div className="feed-post-menu-dropdown">
            {onShare ? <button className="feed-post-menu-btn" type="button" onClick={() => { setPostMenuOpen(false); onShare?.(post); }}>Поделиться</button> : null}
            {allowSave ? <button className="feed-post-menu-btn" type="button" onClick={() => { setPostMenuOpen(false); onToggleSave?.(post.id); }}>{post.is_saved ? 'Убрать из сохранённого' : 'Сохранить'}</button> : null}
            {onReport ? <button className="feed-post-menu-btn" type="button" onClick={() => { setPostMenuOpen(false); onReport?.(post.id); }}>Пожаловаться</button> : null}
            {allowDelete ? <button className="feed-post-menu-btn is-danger" type="button" disabled={busyKey === `delete:${post.id}`} onClick={() => { setPostMenuOpen(false); onDelete?.(post.id); }}>Удалить</button> : null}
          </div>
        </div>
      </div>

      {postText ? (
        <div className="feed-post-text-wrap">
          <div className={`feed-post-text ${expanded ? '' : 'collapsed'}`}>{postText}</div>
          {postText.length > 140 ? (
            <button className="feed-post-more-btn" type="button" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Скрыть' : 'Ещё'}</button>
          ) : null}
        </div>
      ) : null}

      {!isRepost && mediaItems.length ? <ProfilePostMediaBlock media={mediaItems} postId={post.id} /> : null}

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

      {(post.repost_of || post.type === 'repost') ? (
        <div className="feed-post-content-block fsPost-repostBlock is-active">
          <PostRepostPreview post={post.repost_of} />
        </div>
      ) : null}

      <div className="fsPost-statsLine" aria-label="Статистика поста">
        <span>+ {safeStat(post?.stats?.plus)}</span>
        <span>− {safeStat(post?.stats?.minus)}</span>
        <span>{safeStat(post?.stats?.comments)} комм.</span>
        <span>{safeStat(post?.stats?.reposts)} репостов</span>
        <span>{safeStat(post?.stats?.views)} просмотров</span>
      </div>

      <div className="feed-post-footerVk fsPost-footer">
        <div className="feed-post-actionRow fsPost-actionRow" aria-label="Действия с постом">
          {onVote ? (
            <>
              <button
                className={`feed-post-actionBtn is-plus ${post.current_vote === 1 ? 'is-active' : ''}`}
                type="button"
                aria-label="Поставить плюс"
                disabled={busyKey === `vote:${post.id}` || busyKey === `like:${post.id}`}
                onClick={() => onVote(post.id, post.current_vote === 1 ? 0 : 1)}
              >
                <svg viewBox="0 0 24 24"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
                <span>{safeStat(post?.stats?.plus)}</span>
              </button>
              <button
                className={`feed-post-actionBtn is-minus ${post.current_vote === -1 ? 'is-active' : ''}`}
                type="button"
                aria-label="Поставить минус"
                disabled={busyKey === `vote:${post.id}` || busyKey === `like:${post.id}`}
                onClick={() => onVote(post.id, post.current_vote === -1 ? 0 : -1)}
              >
                <svg viewBox="0 0 24 24"><path d="M5 12h14"></path></svg>
                <span>{safeStat(post?.stats?.minus)}</span>
              </button>
            </>
          ) : null}
          <button className={`feed-post-actionBtn ${commentsOpen ? 'is-active' : ''}`} type="button" aria-label="Комментарии" onClick={() => { setCommentsOpen((prev) => { const next = !prev; if (!next) { setCommentReplyTarget(null); setCommentMenuId(null); setCommentComposerError(''); } return next; }); }}>
            <svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.53-.29-3.62-.8L3 21l1.92-5.38A8.47 8.47 0 0 1 4 11.5 8.5 8.5 0 1 1 21 11.5z"></path></svg>
            <span>{safeStat(post?.stats?.comments)}</span>
          </button>
          {onShare ? (
            <button className="feed-post-actionBtn" type="button" aria-label="Поделиться" onClick={() => onShare?.(post)}>
              <svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14"></path><path d="M16 6l4 4-4 4"></path><path d="M20 10H9a5 5 0 0 0-5 5"></path></svg>
              <span>{safeStat(post?.stats?.reposts)}</span>
            </button>
          ) : null}
          {allowSave ? (
            <button className={`feed-post-actionBtn ${post.is_saved ? 'is-active' : ''}`} type="button" aria-label="Сохранить" disabled={busyKey === `save:${post.id}`} onClick={() => onToggleSave?.(post.id)}>
              <svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"></path></svg>
              <span>{safeStat(post?.stats?.saves)}</span>
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
                  placeholder={commentReplyTarget ? getCommentReplyLabel(commentReplyTarget) : 'Написать комментарий…'}
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

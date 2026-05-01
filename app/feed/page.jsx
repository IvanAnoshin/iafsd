'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PostAuthBottomNav from '../../components/PostAuthBottomNav';
import NotificationCenter from '@/components/NotificationCenter';
import { MinimalActionDialog, useMinimalActionDialog } from '@/components/MinimalActionDialog';
import { readPageCache, writePageCache } from '@/lib/page-cache';
import { sanitizeUrlForClient } from '@/lib/url-safety';
import PostRepostPreview from '@/components/PostRepostPreview';
import { COMMUNITIES_UI_ENABLED } from '@/lib/product-flags';
import { buildCommentThreadData, formatCommentAuthorName, getCollapsedCommentText, getCommentAuthorInitial, getCommentModerationHint, getCommentModerationLabel, getCommentModerationTone, getCommentReplyTarget, getCommentRootId, getCommentSocialSignals, getCommentSortLabel, getCommentThreadToggleLabel, getRemainingCommentThreadCount, isCommentTextLong, isCommentVisible, normalizeCommentDraft, sortCommentThreads } from '@/lib/comments-client';

const defaultFeedSettings = {
  default_tab: 'all',
  sort_mode: 'recent',
  show_friends: true,
  show_following: true,
  show_global: true,
  show_communities: COMMUNITIES_UI_ENABLED,
  saved_first: false,
};

const FEED_CACHE_KEY = 'page:feed';
const FEED_CACHE_TTL = 2 * 60 * 1000;
const COMMENT_DRAFT_KEY_PREFIX = 'friendscape:feed-comment-draft:';
const POST_TEXT_LIMIT = 1000;

function getCommentDraftKey(postId) {
  return `${COMMENT_DRAFT_KEY_PREFIX}${Number(postId || 0)}`;
}

function readCommentDraft(postId) {
  if (typeof window === 'undefined') return '';
  const key = getCommentDraftKey(postId);
  if (!key) return '';
  try {
    return String(window.localStorage.getItem(key) || '');
  } catch {
    return '';
  }
}

function writeCommentDraft(postId, value) {
  if (typeof window === 'undefined') return;
  const key = getCommentDraftKey(postId);
  if (!key) return;
  try {
    const nextValue = String(value || '').trim();
    if (nextValue) window.localStorage.setItem(key, String(value || ''));
    else window.localStorage.removeItem(key);
  } catch {}
}

function clearCommentDraft(postId) {
  if (typeof window === 'undefined') return;
  const key = getCommentDraftKey(postId);
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {}
}




function formatTime(value) {
  const date = new Date(value);
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatName(author) {
  return `${author.first_name} ${author.last_name}`.trim();
}

function safeStat(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isClientOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function patchPostVoteState(post, nextVoteValue) {
  if (!post) return post;
  const prevVote = Number(post.current_vote || 0);
  const nextVote = Number(nextVoteValue || 0);
  const plusDelta = (nextVote === 1 ? 1 : 0) - (prevVote === 1 ? 1 : 0);
  const minusDelta = (nextVote === -1 ? 1 : 0) - (prevVote === -1 ? 1 : 0);
  return {
    ...post,
    current_vote: nextVote,
    stats: {
      ...(post.stats || {}),
      plus: Math.max(0, safeStat(post?.stats?.plus) + plusDelta),
      minus: Math.max(0, safeStat(post?.stats?.minus) + minusDelta),
    },
  };
}

function patchPostSaveState(post) {
  if (!post) return post;
  const nextSaved = !post.is_saved;
  return {
    ...post,
    is_saved: nextSaved,
    stats: {
      ...(post.stats || {}),
      saves: Math.max(0, safeStat(post?.stats?.saves) + (nextSaved ? 1 : -1)),
    },
  };
}

function buildCommentText(text) {
  return normalizeCommentDraft(text);
}

function getCommentMeta(comment) {
  return `${formatTime(comment.created_at)}${comment.edited ? ' · изм.' : ''}`;
}

function getCommentInitial(comment) {
  return getCommentAuthorInitial(comment?.author || null);
}


function getCommentReplyLabel(comment) {
  const author = formatCommentAuthorName(comment?.author || null);
  return author ? `Ответ ${author}` : 'Ответ';
}

function getCommentComposerPlaceholder(post, replyTarget) {
  if (replyTarget?.author) return 'Ответить';
  if (post?.author) return 'Написать комментарий';
  return 'Написать комментарий';
}

function getCountWord(value, words) {
  const count = Math.abs(Number(value) || 0);
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return words[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return words[1];
  return words[2];
}

function getCommentCopyText(comment) {
  if (!comment?.moderation?.can_copy) return '';
  return String(comment?.raw_text || comment?.text || '').trim();
}

const FEED_SOURCE_OPTIONS = [
  { id: 'friends', label: 'Друзья', hint: 'Посты людей из близкого круга.' },
  { id: 'following', label: 'Подписки', hint: 'Авторы, на которых пользователь подписан.' },
  { id: 'people', label: 'Новые люди', hint: 'Публичные авторы, с которыми пользователь ещё не связан.' },
  { id: 'all', label: 'Все', hint: 'Друзья, подписки и новые авторы вместе.' },
];

const FEED_SOURCE_LABELS = FEED_SOURCE_OPTIONS.reduce((acc, option) => ({ ...acc, [option.id]: option.label }), {});
const FEED_SOURCE_IDS = new Set(FEED_SOURCE_OPTIONS.map((option) => option.id));

function normalizeFeedSource(value) {
  const next = String(value || '').trim().toLowerCase();
  if (next === 'global') return 'all';
  if (next === 'discovery' || next === 'recommended') return 'people';
  return FEED_SOURCE_IDS.has(next) ? next : 'all';
}

function getAvailableTabs(settings) {
  const tabs = [];
  if (settings.show_friends !== false) tabs.push('friends');
  if (settings.show_following !== false) tabs.push('following');
  if (settings.show_global !== false) tabs.push('people');
  if (COMMUNITIES_UI_ENABLED && settings.show_communities) tabs.push('communities');
  tabs.push('all');
  return [...new Set(tabs.map(normalizeFeedSource))];
}

function getFeedTabLabel(tab) {
  const source = normalizeFeedSource(tab);
  if (source === 'communities') return 'Сообщества';
  return FEED_SOURCE_LABELS[source] || 'Все';
}

function getFeedOrderMode(value) {
  const next = String(value || '').trim().toLowerCase();
  if (next === 'recommended' || next === 'popular') return 'popular';
  return 'recent';
}

function getFeedOrderLabel(value) {
  return getFeedOrderMode(value) === 'popular' ? 'Рекомендации' : 'Сначала новые';
}

function getFeedOrderShortLabel(value) {
  return getFeedOrderMode(value) === 'popular' ? 'Рекомендации' : 'Новые';
}

function getFeedSourceEmptyCopy(source) {
  const normalized = normalizeFeedSource(source);
  if (normalized === 'friends') {
    return {
      title: 'У друзей пока тихо',
      text: 'Когда друзья опубликуют посты или видео, они появятся здесь.',
    };
  }
  if (normalized === 'following') {
    return {
      title: 'В подписках пока пусто',
      text: 'Новые публикации авторов, на которых пользователь подписан, появятся здесь.',
    };
  }
  if (normalized === 'people') {
    return {
      title: 'Новых авторов пока нет',
      text: 'Здесь появятся публикации людей, с которыми пользователь ещё не связан.',
    };
  }
  return {
    title: 'Лента пуста',
    text: 'Публикации из профилей, репостов и доступных сценариев публикации появятся здесь.',
  };
}


function normalizeSettings(input) {
  const next = {
    ...defaultFeedSettings,
    ...(input && typeof input === 'object' ? input : {}),
  };
  next.default_tab = normalizeFeedSource(next.default_tab);
  next.show_friends = next.show_friends !== false;
  next.show_following = next.show_following !== false;
  next.show_global = next.show_global !== false;
  next.sort_mode = getFeedOrderMode(next.sort_mode);
  if (!COMMUNITIES_UI_ENABLED) {
    next.show_communities = false;
    if (next.default_tab === 'communities') next.default_tab = 'all';
  }
  if (!getAvailableTabs(next).includes(next.default_tab)) next.default_tab = 'all';
  return next;
}

function getPopularityScore(post) {
  return (
    safeStat(post?.stats?.plus) * 3
    - safeStat(post?.stats?.minus) * 2
    + safeStat(post?.stats?.comments) * 2
    + safeStat(post?.stats?.reposts)
    + safeStat(post?.stats?.saves)
  );
}

function getPostCreatedMs(post) {
  const value = new Date(post?.created_at || post?.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function getPostAuthorKey(post) {
  return String(post?.author?.id || post?.authorId || post?.author_id || 'unknown');
}

function getPostHoursAge(post, now = Date.now()) {
  const created = getPostCreatedMs(post);
  if (!created) return 999;
  return Math.max(0, (now - created) / 36e5);
}

function getFreshnessScore(post, now = Date.now()) {
  const hours = getPostHoursAge(post, now);
  if (hours <= 2) return 38;
  if (hours <= 12) return 30;
  if (hours <= 24) return 22;
  if (hours <= 72) return 12;
  if (hours <= 168) return 5;
  return 0;
}

function getSocialWeight(post) {
  const channel = getFeedSourceChannel(post);
  if (channel === 'friends') return 18;
  if (channel === 'following') return 12;
  if (channel === 'communities') return 8;
  return 4;
}

function getFeedPostScore(post, now = Date.now()) {
  const stats = post?.stats || {};
  return (
    getFreshnessScore(post, now)
    + getSocialWeight(post)
    + safeStat(stats.plus) * 3
    - safeStat(stats.minus) * 2
    + safeStat(stats.comments) * 4
    + safeStat(stats.saves) * 3
    + safeStat(stats.reposts) * 2
    + Math.min(safeStat(stats.views) * 0.03, 8)
  );
}

function getFeedReasonLabel(post) {
  const stats = post?.stats || {};
  const channel = getFeedSourceChannel(post);
  const hours = getPostHoursAge(post);
  if (post?.repost_of) return 'друг поделился';
  if (safeStat(stats.comments) >= 4) return 'обсуждают';
  if (channel === 'friends' && safeStat(stats.plus) >= 2) return 'популярно у друзей';
  if (safeStat(stats.saves) >= 3) return 'часто сохраняют';
  if (postHasVideo(post)) return 'видеопост';
  if (hours <= 6) return 'свежее';
  if (channel === 'friends') return 'новое от друга';
  if (channel === 'following') return 'новое от подписки';
  if (channel === 'communities') return 'из сообщества';
  return 'из открытой ленты';
}

function spreadRepeatedAuthors(posts) {
  const queue = posts.slice();
  const result = [];
  let lastAuthor = '';

  while (queue.length) {
    let index = queue.findIndex((post) => getPostAuthorKey(post) !== lastAuthor);
    if (index < 0) index = 0;
    const [nextPost] = queue.splice(index, 1);
    result.push(nextPost);
    lastAuthor = getPostAuthorKey(nextPost);
  }

  return result;
}

function rankFeedPosts(posts, orderMode) {
  const now = Date.now();
  const sorted = posts.slice().sort((left, right) => {
    if (getFeedOrderMode(orderMode) === 'popular') {
      const scoreDiff = getFeedPostScore(right, now) - getFeedPostScore(left, now);
      if (scoreDiff !== 0) return scoreDiff;
      const popularityDiff = getPopularityScore(right) - getPopularityScore(left);
      if (popularityDiff !== 0) return popularityDiff;
    }
    return getPostCreatedMs(right) - getPostCreatedMs(left);
  });

  return spreadRepeatedAuthors(sorted);
}

const VIDEO_EXTENSION_RE = /\.(mp4|webm|mov|m4v)(?:[?#].*)?$/i;
function isVideoMediaItem(item) {
  if (!item || typeof item !== 'object') return false;
  const rawKind = String(item.kind || item.type || item.mediaType || item.media_type || '').trim().toLowerCase();
  const mime = String(item.mime || item.contentType || item.content_type || item.fileType || item.file_type || '').trim().toLowerCase();
  const url = String(item.url || item.mediaUrl || item.media_url || item.src || '').trim();
  return rawKind === 'video' || rawKind === 'clip' || mime.startsWith('video/') || VIDEO_EXTENSION_RE.test(url);
}

function getFeedSourceChannel(post) {
  const payload = post?.payload || {};
  if (COMMUNITIES_UI_ENABLED && post?.community) return 'communities';
  const rawChannel = String(
    payload.feedChannel
    || payload.feed_channel
    || payload.channel
    || payload.sourceChannel
    || payload.source_channel
    || ''
  ).trim().toLowerCase();
  if (rawChannel === 'friends') return 'friends';
  if (rawChannel === 'following') return 'following';
  if (rawChannel === 'global' || rawChannel === 'people' || rawChannel === 'discovery' || rawChannel === 'recommended') return 'people';
  return 'following';
}

function normalizeFeedMediaItem(item, index = 0) {
  if (!item || typeof item !== 'object') return null;
  const kind = isVideoMediaItem(item) ? 'video' : 'image';
  const url = sanitizeUrlForClient(item.url || item.mediaUrl || item.media_url || item.src || '');
  const thumbUrl = sanitizeUrlForClient(item.thumbUrl || item.thumb_url || item.thumbnailUrl || item.previewUrl || item.posterUrl || item.poster_url || item.url || item.mediaUrl || item.media_url || item.src || '');
  if (!url && !thumbUrl) return null;
  return {
    id: item.id || item.mediaId || item.storageKey || item.storage_key || `${kind}-${index}`,
    kind,
    url,
    thumbUrl: thumbUrl || url,
    originalName: String(item.originalName || item.original_name || '').trim(),
  };
}


function postHasVideo(post, depth = 0) {
  if (!post || depth > 1) return false;
  const payload = post.payload || {};
  const postType = String(post.type || payload.type || payload.kind || '').trim().toLowerCase();
  if (postType === 'video' || postType === 'clip') return true;
  if (payload.videoUrl || payload.video_url || payload.video) return true;
  if (Array.isArray(payload.media) && payload.media.some(isVideoMediaItem)) return true;
  if (post.repost_of) return postHasVideo(post.repost_of, depth + 1);
  return false;
}


function BaseBottomSheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer = null,
  className = '',
  contentClassName = '',
  sheetRef = null,
  contentRef = null,
  style = undefined,
  onSheetClick,
  dragHandlers = {},
  titleId = 'feed-sheet-title',
  closeLabel = 'Закрыть',
  scope = 'page',
  headStart = null,
}) {
  if (!open) return null;
  const isPostScope = scope === 'post';
  const stopNestedGesture = isPostScope ? ((event) => {
    event.stopPropagation();
  }) : undefined;

  return (
    <>
      <div
        className={`fsSheet-overlay open ${isPostScope ? 'fsSheet-overlayPost' : ''}`}
        data-sheet-scope={scope}
        data-feed-post-sheet={isPostScope ? 'overlay' : undefined}
        onClick={(event) => { event.stopPropagation(); onClose?.(); }}
        onPointerDownCapture={stopNestedGesture}
        onPointerMoveCapture={stopNestedGesture}
        onPointerUpCapture={stopNestedGesture}
        onTouchStartCapture={stopNestedGesture}
        onTouchMoveCapture={stopNestedGesture}
        onTouchEndCapture={stopNestedGesture}
        onMouseDownCapture={stopNestedGesture}
        onMouseMoveCapture={stopNestedGesture}
        onMouseUpCapture={stopNestedGesture}
        onWheelCapture={stopNestedGesture}
        onWheel={isPostScope ? undefined : ((event) => event.preventDefault())}
        onTouchMove={isPostScope ? undefined : ((event) => event.preventDefault())}
      />
      <section
        ref={sheetRef}
        className={`fsSheet open ${isPostScope ? 'fsSheet-post' : ''} ${className}`}
        role="dialog"
        aria-modal={isPostScope ? 'false' : 'true'}
        aria-labelledby={titleId}
        tabIndex={-1}
        style={style}
        data-sheet-scope={scope}
        data-feed-post-sheet={isPostScope ? 'sheet' : undefined}
        onPointerDownCapture={stopNestedGesture}
        onPointerMoveCapture={stopNestedGesture}
        onPointerUpCapture={stopNestedGesture}
        onTouchStartCapture={stopNestedGesture}
        onTouchMoveCapture={stopNestedGesture}
        onTouchEndCapture={stopNestedGesture}
        onMouseDownCapture={stopNestedGesture}
        onMouseMoveCapture={stopNestedGesture}
        onMouseUpCapture={stopNestedGesture}
        onWheelCapture={stopNestedGesture}
        onClick={onSheetClick || ((event) => event.stopPropagation())}
      >
        <div className="fsSheet-dragZone" {...dragHandlers}>
          <div className="fsSheet-handle" aria-hidden="true" />
          <div className="fsSheet-head">
            {headStart ? <div className="fsSheet-headStart">{headStart}</div> : null}
            <div className="fsSheet-titleBlock">
              <div className="fsSheet-title" id={titleId}>{title}</div>
              {subtitle ? <div className="fsSheet-subtitle">{subtitle}</div> : null}
            </div>
            <button className="fsSheet-closeBtn" type="button" onClick={onClose} aria-label={closeLabel}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"></path><path d="M18 6 6 18"></path></svg>
            </button>
          </div>
        </div>
        <div ref={contentRef} className={`fsSheet-content ${contentClassName}`}>
          {children}
        </div>
        {footer ? <div className="fsSheet-footer">{footer}</div> : null}
      </section>
    </>
  );
}

function PostTextSheet({ post, onClose }) {
  const text = String(post?.text || '').trim();
  const author = post?.author ? formatName(post.author) : 'Публикация';
  const meta = post?.created_at ? formatTime(post.created_at) : '';

  return (
    <BaseBottomSheet
      open={Boolean(post && text)}
      title={author}
      subtitle={meta}
      onClose={onClose}
      className="postTextSheet"
      contentClassName="postTextSheet-content feedV10-sheetScroll"
      scope="post"
      titleId="post-text-sheet-title"
    >
      <article className="postTextSheet-body">{text}</article>
    </BaseBottomSheet>
  );
}


function getSharePreviewText(post) {
  const text = String(post?.text || '').trim();
  if (text && text !== 'Медиа') return text;
  const originalText = String(post?.repost_of?.text || '').trim();
  if (originalText && originalText !== 'Медиа') return originalText;
  const media = Array.isArray(post?.payload?.media) ? post.payload.media : [];
  return media.length ? 'Публикация с медиа' : 'Публикация Friendscape';
}

function getSharePreviewAuthor(post) {
  return formatName(post?.author || post?.repost_of?.author || {});
}

function getPostShareUrl(post) {
  if (typeof window === 'undefined') return '';
  const postId = Number(post?.repost_of?.id || post?.id || 0);
  return `${window.location.origin}/feed${postId ? `?post=${postId}` : ''}`;
}

async function getCsrfHeaders() {
  try {
    const response = await fetch('/api/auth/csrf', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    const token = String(data?.csrfToken || '');
    return token ? { 'x-csrf-token': token } : {};
  } catch {
    return {};
  }
}

function RepostSheet({ post, onClose, onRepostResult, onChatShareResult, onSaveToggle }) {
  const [mode, setMode] = useState('actions');
  const [comment, setComment] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [chatQuery, setChatQuery] = useState('');
  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const previewText = useMemo(() => getSharePreviewText(post).slice(0, 180), [post]);
  const previewAuthor = useMemo(() => getSharePreviewAuthor(post), [post]);

  useEffect(() => {
    if (!post) return;
    setMode('actions');
    setComment('');
    setVisibility('public');
    setChatQuery('');
    setChats([]);
    setSelectedChatIds([]);
    setError('');
    setNote('');
    setSending(false);
  }, [post?.id]);

  useEffect(() => {
    if (!post || mode !== 'chatPicker') return undefined;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setChatsLoading(true);
        setError('');
        const params = new URLSearchParams({ limit: '30', scope: 'active' });
        const query = String(chatQuery || '').trim();
        if (query) params.set('q', query);
        const response = await fetch(`/api/chats?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить чаты.');
        if (!cancelled) setChats(Array.isArray(data.items) ? data.items : []);
      } catch (loadError) {
        if (cancelled || loadError?.name === 'AbortError') return;
        setChats([]);
        setError(loadError.message || 'Не удалось загрузить чаты.');
      } finally {
        if (!cancelled) setChatsLoading(false);
      }
    }, 160);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [chatQuery, mode, post]);

  const toggleChat = useCallback((chatId) => {
    const id = String(chatId || '').trim();
    if (!id) return;
    setSelectedChatIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  const copyLink = useCallback(async () => {
    if (!post) return;
    try {
      await navigator.clipboard.writeText(getPostShareUrl(post));
      setNote('Ссылка скопирована');
      window.setTimeout(() => setNote(''), 1400);
    } catch {
      setError('Не удалось скопировать ссылку.');
    }
  }, [post]);

  const publishRepost = useCallback(async () => {
    if (!post) return;
    try {
      setSending(true);
      setError('');
      const headers = { 'Content-Type': 'application/json', ...(await getCsrfHeaders()) };
      const response = await fetch(`/api/posts/${post.id}/repost`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ targetType: 'profile', targetId: null, comment, visibility }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось сделать репост.');
      onRepostResult?.(data, { targetType: 'profile' });
      if (data?.already_exists) {
        setNote('Этот репост уже есть в профиле.');
        return;
      }
      onClose?.();
    } catch (submitError) {
      setError(submitError.message || 'Не удалось сделать репост.');
    } finally {
      setSending(false);
    }
  }, [comment, onClose, onRepostResult, post, visibility]);

  const sendToChats = useCallback(async () => {
    if (!post) return;
    if (!selectedChatIds.length) {
      setError('Выберите хотя бы один чат.');
      return;
    }
    try {
      setSending(true);
      setError('');
      const headers = { 'Content-Type': 'application/json', ...(await getCsrfHeaders()) };
      const response = await fetch(`/api/feed/posts/${post.id}/share`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ conversationIds: selectedChatIds, comment }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось отправить публикацию.');
      onChatShareResult?.(data, { chatIds: selectedChatIds });
      onClose?.();
    } catch (sendError) {
      setError(sendError.message || 'Не удалось отправить публикацию.');
    } finally {
      setSending(false);
    }
  }, [comment, onChatShareResult, onClose, post, selectedChatIds]);

  const openChatPicker = useCallback(() => {
    setMode('chatPicker');
    setError('');
    setNote('');
  }, []);

  const handleSave = useCallback(() => {
    onSaveToggle?.(post?.id);
    onClose?.();
  }, [onClose, onSaveToggle, post?.id]);

  const chatEmptyText = chatQuery.trim() ? 'Чаты не найдены.' : 'Нет доступных чатов.';
  const sheetTitle = mode === 'chatPicker' ? 'Отправить в чат' : 'Поделиться';
  const sheetSubtitle = mode === 'chatPicker'
    ? (selectedChatIds.length ? `${selectedChatIds.length} выбрано` : 'Выберите чат для отправки')
    : 'Репост, чат или ссылка';

  return (
    <BaseBottomSheet
      open={Boolean(post)}
      title={sheetTitle}
      subtitle={sheetSubtitle}
      onClose={onClose}
      className={`feedV7-shareSheet feedV9-shareSheet ${mode === 'chatPicker' ? 'is-chatPicker' : 'is-actions'}`}
      contentClassName={`feedV7-shareContent feedV9-shareContent feedV10-sheetScroll ${mode === 'chatPicker' ? 'feedV9-shareContentChat feedV10-shareContentChat' : ''}`}
      scope="post"
      titleId="feed-share-title"
      headStart={mode === 'chatPicker' ? (
        <button
          type="button"
          className="feedV9-sheetBackBtn"
          aria-label="Назад к вариантам репоста"
          onClick={() => { setMode('actions'); setError(''); setNote(''); }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6"></path></svg>
        </button>
      ) : null}
      footer={mode === 'chatPicker' ? (
        <div className="feedV9-chatPickerFooter feedV10-chatPickerFooter">
          <div className="feedV10-chatFooterMeta" aria-live="polite">
            {selectedChatIds.length ? `${selectedChatIds.length} ${getCountWord(selectedChatIds.length, ['чат выбран', 'чата выбрано', 'чатов выбрано'])}` : 'Выберите чат'}
          </div>
          <div className="feedV10-chatFooterRow">
            <textarea
              className="feedV9-chatMessage"
              value={comment}
              maxLength={420}
              rows={1}
              placeholder="Сообщение к публикации"
              onChange={(event) => setComment(event.target.value)}
            />
            <button
              type="button"
              className="feedV9-chatSendBtn"
              disabled={sending || !selectedChatIds.length}
              onClick={sendToChats}
              aria-label={sending ? 'Отправляем публикацию' : 'Отправить в выбранные чаты'}
            >
              {sending ? (
                <span className="feedV7-shareSpinner" aria-hidden="true" />
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13"></path><path d="m22 2-7 20-4-9-9-4 20-7z"></path></svg>
              )}
            </button>
          </div>
        </div>
      ) : null}
    >
      {mode === 'actions' ? (
        <>
          <div className="feedV7-sharePreview feedV9-sharePreview">
            <div className="feedV7-sharePreviewIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14"></path><path d="M16 6l4 4-4 4"></path><path d="M20 10H9a5 5 0 0 0-5 5"></path></svg>
            </div>
            <div className="feedV7-sharePreviewMain">
              <div className="feedV7-sharePreviewAuthor">{previewAuthor}</div>
              <div className="feedV7-sharePreviewText">{previewText}</div>
            </div>
          </div>

          <label className="feedV7-shareField feedV9-shareComment">
            <span>Комментарий к репосту</span>
            <textarea
              value={comment}
              maxLength={420}
              placeholder="Можно добавить пару слов"
              onChange={(event) => setComment(event.target.value)}
            />
          </label>

          <div className="feedV9-shareActions" aria-label="Варианты репоста">
            <button type="button" className="feedV9-shareActionBtn" disabled={sending} onClick={publishRepost}>
              <span className="feedV9-shareActionIcon" aria-hidden="true">
                {sending ? (
                  <span className="feedV7-shareSpinner" aria-hidden="true" />
                ) : (
                  <svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14"></path><path d="M16 6l4 4-4 4"></path><path d="M20 10H9a5 5 0 0 0-5 5"></path></svg>
                )}
              </span>
              <span>
                <strong>В профиль</strong>
                <small>Опубликовать репост у себя</small>
              </span>
            </button>
            <button type="button" className="feedV9-shareActionBtn" onClick={openChatPicker}>
              <span className="feedV9-shareActionIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg>
              </span>
              <span>
                <strong>В чат</strong>
                <small>Выбрать один или несколько чатов</small>
              </span>
            </button>
            <button type="button" className="feedV9-shareActionBtn" onClick={copyLink}>
              <span className="feedV9-shareActionIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93"></path><path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07"></path></svg>
              </span>
              <span>
                <strong>Копировать ссылку</strong>
                <small>{note || 'Ссылка на оригинальный пост'}</small>
              </span>
            </button>
            <button type="button" className="feedV9-shareActionBtn" onClick={handleSave}>
              <span className="feedV9-shareActionIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M19 21 12 17 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
              </span>
              <span>
                <strong>{post?.is_saved ? 'Убрать из сохранённого' : 'Сохранить'}</strong>
                <small>{post?.is_saved ? 'Удалить из сохранённых' : 'Вернуться к посту позже'}</small>
              </span>
            </button>
          </div>

          <div className="feedV7-shareVisibility" aria-label="Видимость репоста">
            {[
              ['public', 'Все'],
              ['friends', 'Друзья'],
              ['private', 'Только я'],
            ].map(([key, label]) => (
              <button key={key} type="button" className={`feedV7-sharePill ${visibility === key ? 'is-active' : ''}`} onClick={() => setVisibility(key)}>
                {label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="feedV9-chatPicker">
          <label className="feedV7-shareSearch feedV9-chatSearch">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
            <input value={chatQuery} onChange={(event) => setChatQuery(event.target.value)} placeholder="Найти чат" />
          </label>

          <div className="feedV9-chatList feedV10-sheetScroll" role="list" aria-label="Чаты для отправки">
            {chatsLoading ? (
              <div className="feedV9-chatEmpty" role="status">Загружаем чаты…</div>
            ) : chats.length ? chats.map((chat) => {
              const selected = selectedChatIds.includes(String(chat.id));
              return (
                <button
                  key={chat.id}
                  type="button"
                  role="listitem"
                  className={`feedV9-chatItem ${selected ? 'is-selected' : ''}`}
                  onClick={() => toggleChat(chat.id)}
                  aria-pressed={selected}
                >
                  <span className="feedV9-chatAvatar">{chat.initials || String(chat.name || '?').slice(0, 2)}</span>
                  <span className="feedV9-chatMain">
                    <strong>{chat.name || 'Чат'}</strong>
                    <small>{chat.preview || chat.status || 'Можно отправить публикацию'}</small>
                  </span>
                  <span className="feedV9-chatCheck" aria-hidden="true">
                    {selected ? (
                      <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"></path></svg>
                    ) : (
                      <svg viewBox="0 0 24 24"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
                    )}
                  </span>
                </button>
              );
            }) : (
              <div className="feedV9-chatEmpty" role="status">{chatEmptyText}</div>
            )}
          </div>
        </div>
      )}

      {error ? <div className="feedV7-shareError" role="alert">{error}</div> : null}
      {note && mode !== 'actions' ? <div className="feedV7-shareStatus" role="status">{note}</div> : null}
    </BaseBottomSheet>
  );
}

function FeedPost({ post, sheetSlot = null, saveFeedbackLabel = '', onOpenComments, onOpenFullText, onOpenProfile, onOpenCommunity, onVote, onToggleLike, onToggleSave, onReport, onShare, onEdit, onDelete, actionBusyKey }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const payload = post.payload || {};
  const isRepost = Boolean(post?.repost_of);
  const mediaItems = useMemo(() => (Array.isArray(payload.media) ? payload.media.map(normalizeFeedMediaItem).filter(Boolean) : []), [payload.media]);
  const postText = (() => {
    const value = String(post?.text || '').trim();
    if (mediaItems.length && value === 'Медиа') return '';
    return value;
  })();
  const authorMeta = payload.meta || `${isRepost ? 'репостнул · ' : ''}${formatTime(post.created_at)}${post.location ? ` · ${post.location}` : ''}`;
  const feedReason = getFeedReasonLabel(post);
  const previewComment = useMemo(() => {
    const list = Array.isArray(post?.comments) ? post.comments : [];
    return list.find((comment) => isCommentVisible(comment) && String(comment?.text || '').trim()) || null;
  }, [post?.comments]);
  const hasVideo = postHasVideo(post);
  const hasGallery = post.type === 'gallery' && Array.isArray(payload.slides);
  const hasLink = post.type === 'link';
  const hasRepost = Boolean(post.repost_of || post.type === 'repost');
  const hasMedia = mediaItems.length > 0;
  const hasVisualContent = hasVideo || hasMedia || hasGallery || hasLink || hasRepost;
  const isTextOnly = Boolean(postText && !hasVisualContent);
  const typeClassName = [
    isTextOnly ? 'feedV2-card-textOnly' : 'feedV2-card-visual',
    hasMedia ? 'feedV2-card-media' : '',
    hasGallery ? 'feedV2-card-gallery' : '',
    hasLink ? 'feedV2-card-link' : '',
    hasRepost ? 'feedV2-card-repost' : '',
    hasVideo ? 'feedV2-card-video' : '',
    postText && hasVisualContent ? 'feedV2-card-mixed' : '',
  ].filter(Boolean).join(' ');

  return (
    <article className={`feed-post-card feed-page-card fsPost-card feedV2-card ${sheetSlot ? 'feedV2-card-hasSheet feedV10-card-hasSheet' : ''} ${isRepost ? 'fsPost-card-repost' : ''} ${typeClassName}`} data-has-active-sheet={sheetSlot ? 'true' : undefined} onClick={() => menuOpen && setMenuOpen(false)}>
      <div className="feed-post-header">
        <button
          type="button"
          className="feed-post-user feed-post-userBtn"
          onClick={() => onOpenProfile?.(post.author)}
        >
          <div className="feed-post-avatar">{post.author.first_name?.charAt(0) || 'F'}</div>
          <div className="feed-post-user-info">
            <div className="feed-post-name">{formatName(post.author)}</div>
            <div className="feed-post-meta">{authorMeta}</div>
          </div>
        </button>
        <div className={`feed-post-menu-wrap ${menuOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
          <button className="feed-post-menu" type="button" aria-label="Меню поста" onClick={() => setMenuOpen((v) => !v)}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg>
          </button>
          <div className="feed-post-menu-dropdown">
            <button className="feed-post-menu-btn" type="button" onClick={() => { setMenuOpen(false); onShare?.(post, 'share'); }}>Поделиться</button>
            <button className="feed-post-menu-btn" type="button" onClick={() => { setMenuOpen(false); onShare?.(post, 'copy'); }}>Скопировать ссылку</button>
            <button className="feed-post-menu-btn" type="button" onClick={() => { setMenuOpen(false); onToggleSave?.(post.id); }}>{post.is_saved ? 'Убрать из сохранённого' : 'Сохранить'}</button>
            {post.is_mine && !post.community ? <button className="feed-post-menu-btn" type="button" onClick={() => { setMenuOpen(false); onEdit?.(post); }}>Изменить</button> : null}
            {post.is_mine && !post.community ? <button className="feed-post-menu-btn is-danger" type="button" onClick={() => { setMenuOpen(false); onDelete?.(post); }}>Удалить</button> : null}
            {!post.is_mine ? <button className="feed-post-menu-btn" type="button" onClick={() => { setMenuOpen(false); onReport(post.id); }}>Пожаловаться</button> : null}
          </div>
        </div>
      </div>

      {COMMUNITIES_UI_ENABLED && post.community ? (
        <button
          type="button"
          className={`feed-post-communityLink tone-${post.community.avatar_tone || 'violet'}`}
          onClick={() => onOpenCommunity?.(post.community)}
        >
          <span className="feed-post-communityAvatar">{post.community.avatar_url ? <img src={post.community.avatar_url} alt="" /> : String(post.community.name || 'C').charAt(0)}</span>
          <span className="feed-post-communityMain">
            <strong>{post.community.name}</strong>
            <small>{post.community.visibility === 'public' ? 'публичное сообщество' : 'сообщество для участников'}</small>
          </span>
          <span className="feed-post-communityArrow">→</span>
        </button>
      ) : null}


      {post.type === 'gallery' && Array.isArray(payload.slides) && (
        <div className="feed-post-content-block feed-post-gallery is-active">
          <div className="feed-post-gallery-track">
            <button className="feed-post-gallery-nav feed-post-gallery-prev" type="button" aria-label="Предыдущий слайд" onClick={() => setGalleryIndex((galleryIndex - 1 + payload.slides.length) % payload.slides.length)}>
              <svg viewBox="0 0 24 24"><path d="M15 18 9 12l6-6"></path></svg>
            </button>
            <button className="feed-post-gallery-nav feed-post-gallery-next" type="button" aria-label="Следующий слайд" onClick={() => setGalleryIndex((galleryIndex + 1) % payload.slides.length)}>
              <svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"></path></svg>
            </button>
            {payload.slides.map((slide, index) => (
              <div key={`${post.id}-${index}`} className={`feed-post-slide ${index === galleryIndex ? 'active' : ''}`} style={{ backgroundImage: slide.bg }}>
                <span>{slide.text}</span>
              </div>
            ))}
          </div>
          <div className="feed-post-gallery-bottom">
            <div className="feed-post-gallery-dots">
              {payload.slides.map((_, index) => (
                <button key={index} className={`feed-post-gallery-dot ${index === galleryIndex ? 'active' : ''}`} type="button" onClick={() => setGalleryIndex(index)} />
              ))}
            </div>
            <div className="feed-post-gallery-counter">{galleryIndex + 1} / {payload.slides.length}</div>
          </div>
        </div>
      )}

      {post.type === 'video' && (
        <div className="feed-post-content-block feed-post-video-card is-active">
          <div className="video-poster"><div className="play-btn" aria-hidden="true"></div></div>
          <div className="feed-post-video-title">{payload.title}</div>
          <div className="feed-post-video-desc">{payload.desc}</div>
        </div>
      )}

      {!isRepost && mediaItems.length ? (
        <div className="feed-post-content-block feed-post-communityMedia is-active">
          <div className={`feed-post-mediaGrid count-${Math.min(mediaItems.length, 4)}`}>
            {mediaItems.slice(0, 4).map((item, index) => {
              const mediaUrl = item.url;
              const thumbUrl = item.thumbUrl || item.url;
              if (!mediaUrl && !thumbUrl) return null;
              return (
                <a key={`${mediaUrl}-${index}`} href={mediaUrl} target="_blank" rel="noreferrer" className="feed-post-mediaItem">
                  {item.kind === 'video' ? (
                    <video src={mediaUrl} poster={thumbUrl || undefined} preload="metadata" muted playsInline controls={false} draggable={false} onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                  ) : (
                    <img src={thumbUrl || mediaUrl} alt={item.originalName || 'Медиа поста'} loading="lazy" draggable={false} onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                  )}
                  {item.kind === 'video' ? <span>Видео</span> : null}
                </a>
              );
            })}
          </div>
        </div>
      ) : null}

      {post.type === 'link' && (
        <div className="feed-post-content-block feed-post-link-card is-active">
          <div className="link-domain">{payload.domain}</div>
          <div className="feed-post-link-title">{payload.title}</div>
          <div className="feed-post-link-desc">{payload.desc}</div>
        </div>
      )}

      {(post.repost_of || post.type === 'repost') ? (
        <div className="feed-post-content-block fsPost-repostBlock feedV7-repostBlock is-active">
          <div className="feedV7-repostIntro">
            <span className="feedV7-repostLabel">{formatName(post.author)} поделился публикацией</span>
            {post.repost_of?.author ? <span className="feedV7-repostSource">оригинал · {formatName(post.repost_of.author)}</span> : null}
          </div>
          <PostRepostPreview post={post.repost_of} />
        </div>
      ) : null}

      {postText ? (
        <button
          className="feed-post-text-wrap feed-post-textButton"
          type="button"
          onClick={() => onOpenFullText?.(post)}
          aria-label="Открыть полный текст поста"
        >
          <span className="feed-post-text collapsed">{postText}</span>
        </button>
      ) : null}

      <div className="feed-post-footer feed-post-footerVk fsPost-footer feedCardV2-footer">
        <div className="feedCardV2-actions" aria-label="Действия с постом">
          <div className="feedCardV2-voteGroup" aria-label="Оценка поста">
            <button
              className={`feed-post-actionBtn feedCardV2-voteBtn is-plus ${post.current_vote === 1 ? 'is-active' : ''}`}
              type="button"
              aria-label="Поставить плюс"
              disabled={actionBusyKey === `vote:${post.id}` || actionBusyKey === `like:${post.id}`}
              onClick={() => onVote(post.id, post.current_vote === 1 ? 0 : 1)}
            >
              <svg viewBox="0 0 24 24"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
              <span>{safeStat(post?.stats?.plus)}</span>
            </button>
            <button
              className={`feed-post-actionBtn feedCardV2-voteBtn is-minus ${post.current_vote === -1 ? 'is-active' : ''}`}
              type="button"
              aria-label="Поставить минус"
              disabled={actionBusyKey === `vote:${post.id}` || actionBusyKey === `like:${post.id}`}
              onClick={() => onVote(post.id, post.current_vote === -1 ? 0 : -1)}
            >
              <svg viewBox="0 0 24 24"><path d="M5 12h14"></path></svg>
              <span>{safeStat(post?.stats?.minus)}</span>
            </button>
          </div>
          <div className="feedCardV2-socialGroup">
            <button className="feed-post-actionBtn feedCardV2-socialBtn" type="button" aria-label="Открыть комментарии" onClick={() => onOpenComments(post.id)}>
              <svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.2A7.9 7.9 0 0 1 5 4.7 8.5 8.5 0 0 1 13 4a8 8 0 0 1 8 8z"></path></svg>
              <span>{safeStat(post?.stats?.comments)}</span>
            </button>
            <button className="feed-post-actionBtn feedCardV2-socialBtn" type="button" aria-label="Поделиться" onClick={() => onShare?.(post, 'sheet')}>
              <svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"></path><path d="M16 6l-4-4-4 4"></path><path d="M12 2v13"></path></svg>
              <span>{safeStat(post?.stats?.reposts)}</span>
            </button>
            <button className={`feed-post-actionBtn feedCardV2-socialBtn feedV7-saveBtn ${post.is_saved ? 'is-active' : ''} ${saveFeedbackLabel ? 'is-feedback' : ''}`} type="button" aria-label={post.is_saved ? 'Убрать из сохранённого' : 'Сохранить'} disabled={actionBusyKey === `save:${post.id}`} onClick={() => onToggleSave?.(post.id)}>
              <svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"></path></svg>
              <span>{saveFeedbackLabel || safeStat(post?.stats?.saves)}</span>
            </button>
          </div>
        </div>
        <div className="feedCardV2-metaLine" aria-label="Информация о посте">
          <span>{formatTime(post.created_at)}</span>
          <span>{safeStat(post?.stats?.views)} просмотров</span>
          {feedReason ? <span className="feedCardV2-reason">{feedReason}</span> : null}
          {post.community ? <span>{post.community.name}</span> : null}
        </div>
      </div>
      {previewComment ? (
        <button className="feedV2-commentPreview" type="button" onClick={() => onOpenComments(post.id)}>
          <span className="feedV2-commentPreviewText"><strong>{formatCommentAuthorName(previewComment.author)}:</strong> {getCollapsedCommentText(previewComment.text)}</span>
          <span className="feedV2-commentPreviewMore">Показать комментарии · {safeStat(post?.stats?.comments)}</span>
        </button>
      ) : null}
      {sheetSlot}
    </article>
  );
}

export default function FeedPage() {
  const router = useRouter();
  const actionDialog = useMinimalActionDialog();
  const initialCacheRef = useRef(null);
  const [activeChip, setActiveChip] = useState('all');
  const [contentMode, setContentMode] = useState('posts');
  const [feedSettings, setFeedSettings] = useState(normalizeSettings());
  const [settingsDraft, setSettingsDraft] = useState(normalizeSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [posts, setPosts] = useState([]);
  const [fullTextPost, setFullTextPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [search, setSearch] = useState('');
  const [commentPostId, setCommentPostId] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [commentReplyTarget, setCommentReplyTarget] = useState(null);
  const [commentMenuId, setCommentMenuId] = useState(null);
  const [commentComposerError, setCommentComposerError] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentLoadError, setCommentLoadError] = useState('');
  const [expandedCommentBodies, setExpandedCommentBodies] = useState({});
  const [commentSortMode, setCommentSortMode] = useState('activity');
  const [visibleCommentRoots, setVisibleCommentRoots] = useState(6);
  const [busy, setBusy] = useState('');
  const [shareSheetPost, setShareSheetPost] = useState(null);
  const [saveFeedback, setSaveFeedback] = useState(null);
  const [toast, setToast] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const toastTimerRef = useRef(null);
  const postsRef = useRef([]);
  const feedListRef = useRef(null);
  const feedSettingsSheetRef = useRef(null);
  const feedListScrollTopRef = useRef(0);
  const commentTextareaRef = useRef(null);
  const commentSheetRef = useRef(null);
  const commentListRef = useRef(null);
  const commentSheetTouchRef = useRef({ active: false, dragging: false, startY: 0, startX: 0 });
  const hasCommentDraft = Boolean(String(commentText || '').trim());
  const [commentSlowState, setCommentSlowState] = useState(false);
  const [commentSheetDragOffset, setCommentSheetDragOffset] = useState(0);
  const [commentSheetKeyboardInset, setCommentSheetKeyboardInset] = useState(0);
  const commentComposerStateLabel = busy === 'comment'
    ? (commentSlowState ? 'Сеть медленная, всё ещё отправляем…' : 'Отправляем комментарий…')
    : commentComposerError
      ? 'Не отправилось'
      : hasCommentDraft
        ? 'Черновик сохранён'
        : '';

  const isPostSheetOpen = Boolean(commentPostId || fullTextPost || shareSheetPost);
  const activePostSheetKind = commentPostId ? 'comments' : fullTextPost ? 'text' : shareSheetPost ? 'repost' : '';

  const guardFeedGestureWhileSheetOpen = useCallback((event) => {
    if (!isPostSheetOpen) return;
    const target = event.target;
    const isInsideActiveSheet = Boolean(target?.closest?.('.fsSheet-post, .fsSheet-overlayPost'));
    if (isInsideActiveSheet) return;
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
  }, [isPostSheetOpen]);

  const openProfile = useCallback((author) => {
    const authorId = Number(author?.id || 0);
    if (!authorId) return;
    router.push(`/profile/${authorId}?from=feed`);
  }, [router]);

  const openCommunity = useCallback((community) => {
    if (!COMMUNITIES_UI_ENABLED) return;
    const slug = String(community?.slug || '').trim();
    if (!slug) return;
    router.push(`/communities/${slug}?from=feed`);
  }, [router]);

  const showToast = useCallback((message, tone = 'info') => {
    const nextMessage = String(message || '').trim();
    if (!nextMessage) return;
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), message: nextMessage, tone });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  useEffect(() => {
    const updateOnlineState = () => setIsOffline(isClientOffline());
    updateOnlineState();
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, []);

  const closeShareSheet = useCallback(() => {
    setShareSheetPost(null);
  }, []);

  const openFeedSettings = useCallback(() => {
    setSettingsDraft(feedSettings);
    setSettingsOpen(true);
  }, [feedSettings]);

  const closeFeedSettings = useCallback(() => {
    setSettingsDraft(feedSettings);
    setSettingsOpen(false);
  }, [feedSettings]);

  const openShareSheet = useCallback((post) => {
    if (!post) return;
    setFullTextPost(null);
    setShareSheetPost(post);
    setInfoMessage('');
    setError('');
  }, []);

  useLayoutEffect(() => {
    const cachedState = readPageCache(FEED_CACHE_KEY, FEED_CACHE_TTL);
    initialCacheRef.current = cachedState;
    if (!cachedState) return;
    setActiveChip(normalizeFeedSource(cachedState.activeChip || 'all'));
    setContentMode(cachedState.contentMode === 'videos' ? 'videos' : 'posts');
    setFeedSettings(normalizeSettings(cachedState.feedSettings));
    setSettingsDraft(normalizeSettings(cachedState.settingsDraft || cachedState.feedSettings));
    setPosts(Array.isArray(cachedState.posts) ? cachedState.posts : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!commentPostId) return;
    setCommentComposerError('');
    setCommentText(readCommentDraft(commentPostId));
  }, [commentPostId]);

  useEffect(() => {
    if (!commentPostId) return;
    writeCommentDraft(commentPostId, commentText);
  }, [commentPostId, commentText]);

  useLayoutEffect(() => {
    const node = commentTextareaRef.current;
    if (!node) return;
    node.style.height = '0px';
    const nextHeight = Math.min(Math.max(node.scrollHeight, 42), 120);
    node.style.height = `${nextHeight}px`;
  }, [commentPostId, commentText, commentReplyTarget]);

  useEffect(() => {
    if (busy !== 'comment') {
      setCommentSlowState(false);
      return;
    }
    const timer = window.setTimeout(() => setCommentSlowState(true), 1800);
    return () => window.clearTimeout(timer);
  }, [busy]);

  const patchPostSnapshot = (postId, nextPost) => {
    if (!nextPost) return;
    setPosts((prev) => prev.map((post) => (post.id === postId ? nextPost : post)));
  };

  const upsertPostSnapshot = (nextPost, { prepend = false } = {}) => {
    if (!nextPost?.id) return;
    setPosts((prev) => {
      const exists = prev.some((post) => Number(post.id) === Number(nextPost.id));
      if (exists) return prev.map((post) => (Number(post.id) === Number(nextPost.id) ? nextPost : post));
      return prepend ? [nextPost, ...prev] : [...prev, nextPost];
    });
  };

  const availableTabs = useMemo(() => getAvailableTabs(feedSettings), [feedSettings]);

  const loadFeed = useCallback(async ({ silent = false, feedback = false } = {}) => {
    const offlineMessage = 'Нет соединения. Показываем уже загруженную ленту.';
    if (isClientOffline()) {
      setIsOffline(true);
      if (postsRef.current.length) {
        setError('');
        showToast(offlineMessage, 'warning');
        return;
      }
      setError('Нет соединения. Попробуйте обновить ленту позже.');
      setLoading(false);
      return;
    }

    try {
      if (!silent) setLoading(true);
      if (silent) setRefreshing(true);
      setError('');
      const response = await fetch('/api/feed', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить ленту.');
      const nextSettings = normalizeSettings(data.settings);
      setFeedSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setPosts(data.posts || []);
      setActiveChip((prev) => {
        const tabs = getAvailableTabs(nextSettings);
        if (tabs.includes(prev)) return prev;
        return tabs.includes(nextSettings.default_tab) ? nextSettings.default_tab : tabs[0];
      });
      if (feedback) showToast('Лента обновлена.', 'success');
    } catch (loadError) {
      console.warn('feed load fallback enabled', loadError?.message || loadError);
      const message = 'Не удалось обновить ленту. Проверьте подключение и попробуйте снова.';
      if (postsRef.current.length) {
        setError('');
        showToast(message, 'warning');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    const hasWarmCache = Boolean(initialCacheRef.current);
    loadFeed({ silent: hasWarmCache });
  }, [loadFeed]);

  useEffect(() => {
    if (!posts.length && loading) return;
    writePageCache(FEED_CACHE_KEY, {
      activeChip,
      contentMode,
      feedSettings,
      settingsDraft,
      posts,
    });
  }, [activeChip, contentMode, feedSettings, settingsDraft, posts, loading]);

  useEffect(() => {
    const normalized = normalizeFeedSource(activeChip);
    if (normalized !== activeChip) {
      setActiveChip(normalized);
      return;
    }
    if (!availableTabs.includes(activeChip)) {
      setActiveChip(availableTabs.includes('all') ? 'all' : availableTabs[0]);
    }
  }, [activeChip, availableTabs]);

  useEffect(() => {
    const videoPageClass = 'feedV2-videoPage';
    const isVideoPage = contentMode === 'videos';
    document.documentElement.classList.toggle(videoPageClass, isVideoPage);
    document.body.classList.toggle(videoPageClass, isVideoPage);
    return () => {
      document.documentElement.classList.remove(videoPageClass);
      document.body.classList.remove(videoPageClass);
    };
  }, [contentMode]);

  useEffect(() => {
    const activeClass = 'feedV10-hasPostSheet';
    document.documentElement.classList.toggle(activeClass, isPostSheetOpen);
    document.body.classList.toggle(activeClass, isPostSheetOpen);
    return () => {
      document.documentElement.classList.remove(activeClass);
      document.body.classList.remove(activeClass);
    };
  }, [isPostSheetOpen]);

  useEffect(() => {
    const hasOverlayOpen = Boolean(settingsOpen);
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyTouchAction = document.body.style.touchAction;
    const previousRootOverscroll = document.documentElement.style.overscrollBehavior;
    if (hasOverlayOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = settingsOpen ? 'none' : '';
      document.documentElement.style.overscrollBehavior = 'none';
    }
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.touchAction = previousBodyTouchAction;
      document.documentElement.style.overscrollBehavior = previousRootOverscroll;
    };
  }, [settingsOpen]);

  useEffect(() => {
    const node = feedListRef.current;
    const hasBlockingSheet = Boolean(settingsOpen || isPostSheetOpen);
    if (!node || !hasBlockingSheet) return undefined;
    feedListScrollTopRef.current = node.scrollTop;
    const previousOverflowY = node.style.overflowY;
    const previousOverscrollBehavior = node.style.overscrollBehavior;
    const previousTouchAction = node.style.touchAction;
    const previousScrollSnapType = node.style.scrollSnapType;
    node.style.overflowY = 'hidden';
    node.style.overscrollBehavior = 'none';
    node.style.touchAction = settingsOpen ? 'none' : '';
    node.style.scrollSnapType = 'none';
    node.dataset.feedOverlayLocked = isPostSheetOpen ? 'post' : 'page';
    return () => {
      node.style.overflowY = previousOverflowY;
      node.style.overscrollBehavior = previousOverscrollBehavior;
      node.style.touchAction = previousTouchAction;
      node.style.scrollSnapType = previousScrollSnapType;
      node.scrollTop = feedListScrollTopRef.current;
      delete node.dataset.feedOverlayLocked;
    };
  }, [settingsOpen, isPostSheetOpen]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (shareSheetPost) {
        closeShareSheet();
        return;
      }
      if (commentPostId) {
        setCommentPostId(null);
        return;
      }
      if (fullTextPost) {
        setFullTextPost(null);
        return;
      }
      if (settingsOpen) {
        closeFeedSettings();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeFeedSettings, closeShareSheet, commentPostId, fullTextPost, settingsOpen, shareSheetPost]);

  useEffect(() => {
    if (fullTextPost) setFullTextPost(null);
    if (shareSheetPost) closeShareSheet();
    if (!commentPostId) return;
    setCommentPostId(null);
    setCommentText('');
    setCommentReplyTarget(null);
    setCommentMenuId(null);
  }, [activeChip, closeShareSheet, contentMode, search]);

  useEffect(() => {
    if (!settingsOpen) return;
    if (commentPostId) setCommentPostId(null);
    if (fullTextPost) setFullTextPost(null);
    if (shareSheetPost) closeShareSheet();
  }, [closeShareSheet, commentPostId, fullTextPost, settingsOpen, shareSheetPost]);

  useEffect(() => {
    if (!settingsOpen) return;
    window.requestAnimationFrame(() => {
      feedSettingsSheetRef.current?.focus({ preventScroll: true });
    });
  }, [settingsOpen]);

  const currentComments = useMemo(() => {
    const post = posts.find((item) => item.id === commentPostId);
    return post?.comments || [];
  }, [posts, commentPostId]);

  const commentPost = useMemo(() => posts.find((item) => item.id === commentPostId) || null, [posts, commentPostId]);
  const { topLevelComments, repliesByRootId, byId: commentById } = useMemo(() => buildCommentThreadData(currentComments), [currentComments]);
  const sortedTopLevelComments = useMemo(() => sortCommentThreads(topLevelComments, repliesByRootId, commentSortMode, {
    postAuthorId: Number(commentPost?.author?.id || 0),
  }), [commentPost?.author?.id, commentSortMode, repliesByRootId, topLevelComments]);
  const visibleTopLevelComments = useMemo(() => sortedTopLevelComments.slice(0, visibleCommentRoots), [sortedTopLevelComments, visibleCommentRoots]);
  const remainingCommentThreads = useMemo(() => getRemainingCommentThreadCount(sortedTopLevelComments, visibleCommentRoots), [sortedTopLevelComments, visibleCommentRoots]);
  const commentElementRefs = useRef(new Map());
  const commentHighlightTimerRef = useRef(null);
  const [expandedReplyRoots, setExpandedReplyRoots] = useState({});
  const [highlightedCommentId, setHighlightedCommentId] = useState(null);

  const focusCommentById = useCallback((commentId) => {
    const normalizedId = Number(commentId || 0);
    if (!normalizedId) return;
    const nextComment = commentById.get(normalizedId) || null;
    if (nextComment) {
      const rootId = getCommentRootId(nextComment, commentById);
      if (rootId && rootId !== normalizedId) {
        setExpandedReplyRoots((prev) => ({ ...prev, [rootId]: true }));
      }
    }
    setVisibleCommentRoots((prev) => Math.max(prev, sortedTopLevelComments.length || 0));
    window.requestAnimationFrame(() => {
      const nextNode = commentElementRefs.current.get(normalizedId);
      if (!nextNode) return;
      nextNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedCommentId(normalizedId);
      if (commentHighlightTimerRef.current) window.clearTimeout(commentHighlightTimerRef.current);
      commentHighlightTimerRef.current = window.setTimeout(() => setHighlightedCommentId(null), 1800);
    });
  }, [commentById, sortedTopLevelComments.length]);

  const ensureThreadOpen = useCallback((comment) => {
    const rootId = getCommentRootId(comment, commentById);
    if (!rootId) return;
    setExpandedReplyRoots((prev) => ({ ...prev, [rootId]: true }));
  }, [commentById]);


  const focusCommentComposer = useCallback(() => {
    const node = commentTextareaRef.current;
    if (!node) return;
    node.focus();
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  useEffect(() => {
    if (!commentPostId || typeof window === 'undefined' || !window.visualViewport) {
      setCommentSheetKeyboardInset(0);
      return;
    }
    const viewport = window.visualViewport;
    const updateInset = () => {
      const nextInset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      setCommentSheetKeyboardInset(nextInset > 64 ? nextInset : 0);
    };
    updateInset();
    viewport.addEventListener('resize', updateInset);
    viewport.addEventListener('scroll', updateInset);
    return () => {
      viewport.removeEventListener('resize', updateInset);
      viewport.removeEventListener('scroll', updateInset);
    };
  }, [commentPostId]);

  useEffect(() => {
    if (!commentPostId) return;
    window.requestAnimationFrame(() => {
      commentSheetRef.current?.focus({ preventScroll: true });
    });
  }, [commentPostId]);

  const resetCommentSheetGesture = useCallback(() => {
    commentSheetTouchRef.current = { active: false, dragging: false, startY: 0, startX: 0 };
    setCommentSheetDragOffset(0);
  }, []);

  const handleCommentSheetTouchStart = useCallback((event) => {
    if (!commentPostId) return;
    if (commentListRef.current && commentListRef.current.scrollTop > 2) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    commentSheetTouchRef.current = {
      active: true,
      dragging: false,
      startY: touch.clientY,
      startX: touch.clientX,
    };
  }, [commentPostId]);

  const handleCommentSheetTouchMove = useCallback((event) => {
    const state = commentSheetTouchRef.current;
    if (!state.active) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const deltaY = touch.clientY - state.startY;
    const deltaX = touch.clientX - state.startX;
    if (!state.dragging) {
      if (Math.abs(deltaY) < 6) return;
      if (Math.abs(deltaX) > Math.abs(deltaY) || deltaY <= 0) {
        commentSheetTouchRef.current = { active: false, dragging: false, startY: 0, startX: 0 };
        setCommentSheetDragOffset(0);
        return;
      }
      commentSheetTouchRef.current = { ...state, dragging: true };
    }
    if (deltaY > 0) {
      event.preventDefault();
      setCommentSheetDragOffset(Math.min(deltaY, 220));
    }
  }, []);

  const handleCommentSheetTouchEnd = useCallback(() => {
    const shouldClose = commentSheetDragOffset > 120;
    resetCommentSheetGesture();
    if (shouldClose) {
      setCommentPostId(null);
      setCommentReplyTarget(null);
      setCommentMenuId(null);
      setCommentComposerError('');
      setCommentLoadError('');
    }
  }, [commentSheetDragOffset, resetCommentSheetGesture]);

  useEffect(() => {
    if (!commentPostId) {
      setCommentReplyTarget(null);
      setCommentMenuId(null);
      setExpandedReplyRoots({});
      setHighlightedCommentId(null);
      setCommentSortMode('activity');
      setVisibleCommentRoots(6);
      setCommentLoadError('');
      setCommentLoading(false);
      setExpandedCommentBodies({});
      setCommentSheetKeyboardInset(0);
      setCommentSheetDragOffset(0);
      commentSheetTouchRef.current = { active: false, dragging: false, startY: 0, startX: 0 };
      if (commentHighlightTimerRef.current) {
        window.clearTimeout(commentHighlightTimerRef.current);
        commentHighlightTimerRef.current = null;
      }
      return;
    }
    setCommentSortMode('activity');
    setVisibleCommentRoots(6);
    setCommentLoadError('');
    setExpandedCommentBodies({});
  }, [commentPostId]);

  useEffect(() => () => {
    if (commentHighlightTimerRef.current) {
      window.clearTimeout(commentHighlightTimerRef.current);
    }
  }, []);

  const handleContentModeChange = (nextMode) => {
    if (nextMode === contentMode) return;
    setContentMode(nextMode);
    setSettingsOpen(false);
    setCommentPostId(null);
    setShareSheetPost(null);
  };

  const handleContentModeKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    handleContentModeChange(contentMode === 'videos' ? 'posts' : 'videos');
  };

  const sourcePosts = useMemo(() => {
    const source = normalizeFeedSource(activeChip);
    if (source === 'all') return posts;
    return posts.filter((post) => getFeedSourceChannel(post) === source);
  }, [activeChip, posts]);

  const visiblePosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = sourcePosts.filter((post) => {
      const payload = post.payload || {};
      const isVideoPost = postHasVideo(post);
      if (contentMode === 'videos' && !isVideoPost) return false;
      if (contentMode !== 'videos' && isVideoPost) return false;
      if (!q) return true;
      const haystack = [
        post.text,
        formatName(post.author),
        payload.title,
        payload.desc,
        payload.domain,
        payload.innerTitle,
        payload.innerDesc,
        post.community?.name,
        post.community?.slug,
        post.repost_of?.text,
        post.repost_of?.author?.first_name,
        post.repost_of?.author?.last_name,
        post.repost_of?.community?.name,
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });

    return rankFeedPosts(filtered, feedSettings.sort_mode);
  }, [contentMode, feedSettings.sort_mode, search, sourcePosts]);

  const emptyState = useMemo(() => {
    const query = search.trim();
    const sourceLabel = getFeedTabLabel(activeChip);
    const orderLabel = getFeedOrderShortLabel(feedSettings.sort_mode);
    const modeLabel = contentMode === 'videos' ? 'Видео' : 'Посты';
    const kicker = `${sourceLabel} · ${modeLabel}`;
    const hasSourceVideos = sourcePosts.some((post) => postHasVideo(post));
    const hasSourcePosts = sourcePosts.some((post) => !postHasVideo(post));
    const hasAllSource = availableTabs.includes('all');

    if (query) {
      return {
        kicker: `Поиск · ${modeLabel}`,
        title: 'Ничего не найдено',
        text: 'Сбросьте поиск или выберите другой источник.',
        actions: [
          { id: 'clear-search', label: 'Сбросить поиск' },
          { id: 'settings', label: 'Сменить источник', ghost: true },
        ],
      };
    }

    if (!posts.length) {
      return {
        kicker: `Все · ${orderLabel}`,
        title: 'Лента пуста',
        text: 'Публикации из профилей, репостов и доступных сценариев публикации появятся здесь.',
        actions: [
          { id: 'reload', label: 'Обновить' },
          { id: 'settings', label: 'Настроить', ghost: true },
        ],
      };
    }

    if (!sourcePosts.length) {
      const sourceCopy = getFeedSourceEmptyCopy(activeChip);
      return {
        kicker,
        title: sourceCopy.title,
        text: sourceCopy.text,
        actions: [
          hasAllSource && activeChip !== 'all'
            ? { id: 'all', label: 'Открыть все' }
            : { id: 'settings', label: 'Сменить источник' },
          { id: 'settings', label: 'Настроить', ghost: true },
        ].filter(Boolean),
      };
    }

    if (contentMode === 'videos' && !hasSourceVideos) {
      return {
        kicker,
        title: 'Видео здесь пока нет',
        text: `В источнике «${sourceLabel}» сейчас есть посты, но нет видеоконтента.`,
        actions: [
          { id: 'posts', label: 'Смотреть посты' },
          activeChip !== 'all' ? { id: 'all', label: 'Открыть все', ghost: true } : { id: 'settings', label: 'Сменить источник', ghost: true },
        ],
      };
    }

    if (contentMode !== 'videos' && !hasSourcePosts) {
      return {
        kicker,
        title: 'Постов здесь пока нет',
        text: `В источнике «${sourceLabel}» сейчас есть видео, но нет обычных постов.`,
        actions: [
          { id: 'videos', label: 'Смотреть видео' },
          activeChip !== 'all' ? { id: 'all', label: 'Открыть все', ghost: true } : { id: 'settings', label: 'Сменить источник', ghost: true },
        ],
      };
    }

    return {
      kicker,
      title: contentMode === 'videos' ? 'Видео пока нет' : 'Постов пока нет',
      text: `В источнике «${sourceLabel}» пока нет контента для этого режима.`,
      actions: [{ id: 'settings', label: 'Сменить источник' }],
    };
  }, [activeChip, availableTabs, contentMode, feedSettings.sort_mode, posts.length, search, sourcePosts]);

  const handleEmptyAction = (actionId) => {
    if (actionId === 'posts') {
      handleContentModeChange('posts');
      return;
    }
    if (actionId === 'videos') {
      handleContentModeChange('videos');
      return;
    }
    if (actionId === 'settings') {
      openFeedSettings();
      return;
    }
    if (actionId === 'clear-search') {
      setSearch('');
      return;
    }
    if (actionId === 'all') {
      setActiveChip('all');
      return;
    }
    if (actionId === 'reload') {
      loadFeed();
    }
  };

  const patchCommentsForPost = (postId, updater) => {
    setPosts((prev) => prev.map((post) => {
      if (post.id !== postId) return post;
      const nextComments = typeof updater === 'function' ? updater(post.comments || []) : updater;
      return {
        ...post,
        comments: nextComments,
        stats: {
          ...post.stats,
          comments: nextComments.length,
        },
      };
    }));
  };

  const handleVote = async (postId, value) => {
    if (busy === `vote:${postId}`) return;
    const previousPost = postsRef.current.find((post) => Number(post.id) === Number(postId));
    if (isClientOffline()) {
      showToast('Нет соединения. Голос не отправлен.', 'warning');
      return;
    }
    try {
      setBusy(`vote:${postId}`);
      setError('');
      if (previousPost) patchPostSnapshot(postId, patchPostVoteState(previousPost, value));
      const response = await fetch(`/api/feed/posts/${postId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить голос.');
      patchPostSnapshot(postId, data.post);
    } catch (voteError) {
      if (previousPost) patchPostSnapshot(postId, previousPost);
      showToast(voteError.message || 'Не удалось обновить голос.', 'warning');
    } finally {
      setBusy('');
    }
  };

  const handleToggleSave = async (postId) => {
    if (busy === `save:${postId}`) return;
    const previousPost = postsRef.current.find((post) => Number(post.id) === Number(postId));
    if (isClientOffline()) {
      showToast('Нет соединения. Сохранение не обновлено.', 'warning');
      return;
    }
    try {
      setBusy(`save:${postId}`);
      setError('');
      const optimisticPost = previousPost ? patchPostSaveState(previousPost) : null;
      if (optimisticPost) patchPostSnapshot(postId, optimisticPost);
      const response = await fetch(`/api/feed/posts/${postId}/save`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить сохранение.');
      patchPostSnapshot(postId, data.post);
      const saved = Boolean(data?.post?.is_saved);
      const label = saved ? 'Сохранено' : 'Убрано';
      setSaveFeedback({ postId, label });
      showToast(saved ? 'Пост сохранён.' : 'Пост убран из сохранённого.', 'success');
      window.setTimeout(() => {
        setSaveFeedback((prev) => (Number(prev?.postId || 0) === Number(postId) ? null : prev));
      }, 1400);
    } catch (saveError) {
      if (previousPost) patchPostSnapshot(postId, previousPost);
      showToast(saveError.message || 'Не удалось обновить сохранение.', 'warning');
    } finally {
      setBusy('');
    }
  };

  const handleToggleLike = async (post) => {
    if (!post?.id || busy === `like:${post.id}`) return;
    const isLiked = Boolean(post?.is_liked);
    if (isClientOffline()) {
      showToast('Нет соединения. Действие не отправлено.', 'warning');
      return;
    }
    try {
      setBusy(`like:${post.id}`);
      setError('');
      const response = await fetch(`/api/posts/${post.id}/like`, {
        method: isLiked ? 'DELETE' : 'POST',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (isLiked ? 'Не удалось снять лайк.' : 'Не удалось поставить лайк.'));
      patchPostSnapshot(post.id, data.post);
    } catch (likeError) {
      showToast(likeError.message || 'Не удалось обновить лайк.', 'warning');
    } finally {
      setBusy('');
    }
  };

  const openComments = async (postId) => {
    if (busy === `comments:${postId}`) return;
    setFullTextPost(null);
    setCommentPostId(postId);
    setCommentReplyTarget(null);
    setCommentMenuId(null);
    setCommentComposerError('');
    setCommentLoadError('');
    if (isClientOffline()) {
      setCommentLoadError('Нет соединения. Комментарии не обновились.');
      showToast('Нет соединения. Комментарии могут быть неактуальны.', 'warning');
      setCommentLoading(false);
      return;
    }
    setCommentLoading(true);
    try {
      const response = await fetch(`/api/posts/${postId}/comments`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить комментарии.');
      patchCommentsForPost(postId, data.comments || []);
    } catch (loadCommentsError) {
      const nextMessage = loadCommentsError.message || 'Не удалось загрузить комментарии.';
      setCommentLoadError(nextMessage);
      showToast(nextMessage, 'warning');
    } finally {
      setCommentLoading(false);
    }
  };

  const addComment = async () => {
    const text = buildCommentText(commentText);
    if (!text || !commentPostId || busy === 'comment') return;
    if (isClientOffline()) {
      const nextMessage = 'Нет соединения. Комментарий не отправлен.';
      setCommentComposerError(nextMessage);
      showToast(nextMessage, 'warning');
      return;
    }
    try {
      setBusy('comment');
      setCommentComposerError('');
      const response = await fetch(`/api/posts/${commentPostId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, reply_to_comment_id: commentReplyTarget?.id || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось добавить комментарий.');
      if (data.post) {
        patchPostSnapshot(commentPostId, data.post);
      } else if (data.comment) {
        patchCommentsForPost(commentPostId, (prev) => [data.comment, ...prev]);
      }
      if (commentReplyTarget) ensureThreadOpen(commentReplyTarget);
      clearCommentDraft(commentPostId);
      setCommentText('');
      setCommentReplyTarget(null);
      showToast('Комментарий опубликован.', 'success');
    } catch (commentError) {
      const nextMessage = commentError.message || 'Не удалось добавить комментарий.';
      setCommentComposerError(nextMessage);
      showToast(nextMessage, 'warning');
    } finally {
      setBusy('');
    }
  };

  const handleCommentReply = (comment) => {
    if (!comment || !comment?.moderation?.can_reply) return;
    ensureThreadOpen(comment);
    setCommentReplyTarget(comment);
    setCommentMenuId(null);
    setCommentComposerError('');
  };

  const handleCommentCopy = async (comment) => {
    const text = getCommentCopyText(comment);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setInfoMessage('Текст комментария скопирован.');
      setCommentMenuId(null);
    } catch (_error) {
      setError('Не удалось скопировать комментарий.');
    }
  };

  const handleCommentVote = async (commentId, value) => {
    if (!commentPostId) return;
    try {
      setBusy(`comment-vote:${commentId}`);
      const response = await fetch(`/api/comments/${commentId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить голос комментария.');
      if (data.comment) {
        patchCommentsForPost(commentPostId, (prev) => prev.map((item) => item.id === commentId ? data.comment : item));
      }
    } catch (voteError) {
      setError(voteError.message || 'Не удалось обновить голос комментария.');
    } finally {
      setBusy('');
    }
  };

  const handleCommentEdit = async (comment) => {
    if (!comment?.is_mine || !comment?.moderation?.can_edit) return;
    setCommentMenuId(null);
    const nextText = await actionDialog.askText({ title: 'Изменить комментарий', initialValue: comment.text || '', submitLabel: 'Сохранить' });
    if (nextText == null) return;
    const text = nextText.trim();
    if (!text || text === comment.text) return;

    try {
      setBusy(`comment-edit:${comment.id}`);
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить комментарий.');
      if (data.comment) {
        patchCommentsForPost(commentPostId, (prev) => prev.map((item) => item.id === comment.id ? data.comment : item));
      }
    } catch (editError) {
      setError(editError.message || 'Не удалось обновить комментарий.');
    } finally {
      setBusy('');
    }
  };

  const handleCommentDelete = async (comment) => {
    if (!comment?.is_mine || !comment?.moderation?.can_delete) return;
    setCommentMenuId(null);
    const confirmed = await actionDialog.confirmAction({ title: 'Удалить комментарий?', text: 'Комментарий исчезнет из обсуждения.', submitLabel: 'Удалить', danger: true });
    if (!confirmed) return;

    try {
      setBusy(`comment-delete:${comment.id}`);
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось удалить комментарий.');
      if (data.comment) {
        patchCommentsForPost(commentPostId, (prev) => prev.map((item) => item.id === comment.id ? data.comment : item));
      }
    } catch (deleteError) {
      setError(deleteError.message || 'Не удалось удалить комментарий.');
    } finally {
      setBusy('');
    }
  };

  const handleCommentReport = async (comment) => {
    if (!comment?.moderation?.can_report) return;
    setCommentMenuId(null);
    const reason = await actionDialog.askText({ title: 'Жалоба на комментарий', label: 'Причина', placeholder: 'Спам, оскорбление, обман или другое', submitLabel: 'Отправить' });
    if (reason == null) return;
    const normalized = reason.trim();
    if (!normalized) return;

    try {
      setBusy(`comment-report:${comment.id}`);
      const response = await fetch(`/api/reports/comments/${comment.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: normalized, details: normalized }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось отправить жалобу на комментарий.');
      if (data.comment && commentPostId) {
        patchCommentsForPost(commentPostId, (prev) => prev.map((item) => item.id === comment.id ? data.comment : item));
      }
      setInfoMessage(data.message || 'Жалоба на комментарий отправлена.');
    } catch (reportError) {
      setError(reportError.message || 'Не удалось отправить жалобу на комментарий.');
    } finally {
      setBusy('');
    }
  };



  const handleEditPost = async (post) => {
    if (!post?.is_mine || post?.community) return;
    const nextText = await actionDialog.askText({
      title: 'Изменить пост',
      label: 'Текст публикации',
      initialValue: post.text || '',
      submitLabel: 'Сохранить',
    });
    if (nextText == null) return;
    const text = nextText.trim();
    if (text.length > POST_TEXT_LIMIT) {
      setError(`Текст поста не должен превышать ${POST_TEXT_LIMIT} символов.`);
      return;
    }
    if (!text || text === String(post.text || '').trim()) return;

    try {
      setBusy(`post-edit:${post.id}`);
      setError('');
      const response = await fetch(`/api/feed/posts/${post.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, visibility: post.visibility || 'public' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить пост.');
      if (data.post) patchPostSnapshot(post.id, data.post);
      setInfoMessage(data.message || 'Пост обновлён.');
    } catch (editError) {
      setError(editError.message || 'Не удалось обновить пост.');
    } finally {
      setBusy('');
    }
  };

  const handleDeletePost = async (post) => {
    if (!post?.is_mine || post?.community) return;
    const confirmed = await actionDialog.confirmAction({
      title: 'Удалить пост?',
      text: 'Публикация исчезнет из ленты и профиля.',
      submitLabel: 'Удалить',
      danger: true,
    });
    if (!confirmed) return;

    try {
      setBusy(`post-delete:${post.id}`);
      setError('');
      const response = await fetch(`/api/feed/posts/${post.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось удалить пост.');
      setPosts((prev) => prev.filter((item) => item.id !== post.id));
      setInfoMessage(data.message || 'Пост удалён.');
    } catch (deleteError) {
      setError(deleteError.message || 'Не удалось удалить пост.');
    } finally {
      setBusy('');
    }
  };


  const handleReportPost = async (postId) => {
    const reason = await actionDialog.askText({ title: 'Жалоба на публикацию', label: 'Причина', placeholder: 'Спам, оскорбление, обман или другое', submitLabel: 'Отправить' });
    if (reason == null) return;
    const normalized = reason.trim();
    if (!normalized) return;

    try {
      setBusy(`report:${postId}`);
      const response = await fetch(`/api/reports/posts/${postId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: normalized, details: normalized }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось отправить жалобу.');
      setInfoMessage(data.message || 'Жалоба отправлена.');
    } catch (reportError) {
      setError(reportError.message || 'Не удалось отправить жалобу.');
    } finally {
      setBusy('');
    }
  };


  const handleSharePost = async (post, mode = 'sheet') => {
    const postId = Number(post?.id || 0);
    if (!postId || typeof window === 'undefined') return;
    const url = `${window.location.origin}/feed?post=${postId}`;
    setInfoMessage('');
    setError('');
    setSettingsOpen(false);
    setCommentPostId(null);

    if (mode === 'copy') {
      try {
        await navigator.clipboard.writeText(url);
        closeShareSheet();
        showToast('Ссылка скопирована.', 'success');
      } catch (_error) {
        showToast('Не удалось скопировать ссылку на публикацию.', 'warning');
      }
      return;
    }

    openShareSheet(post);
  };

  const saveFeedSettings = async () => {
    try {
      setSavingSettings(true);
      setError('');
      const response = await fetch('/api/feed/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settingsDraft, default_tab: normalizeFeedSource(settingsDraft.default_tab), show_friends: true, show_following: true, show_global: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить настройки ленты.');
      const nextSettings = normalizeSettings(data.settings);
      setFeedSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setActiveChip(getAvailableTabs(nextSettings).includes(nextSettings.default_tab) ? nextSettings.default_tab : getAvailableTabs(nextSettings)[0]);
      setSettingsOpen(false);
      showToast('Настройки ленты сохранены.', 'success');
      await loadFeed({ silent: true });
    } catch (settingsError) {
      showToast(settingsError.message || 'Не удалось сохранить настройки ленты.', 'warning');
    } finally {
      setSavingSettings(false);
    }
  };

  const renderCommentCard = (comment, nested = false) => {
    const menuOpen = commentMenuId === comment.id;
    const replyTarget = getCommentReplyTarget(comment, commentById);
    const replyLabel = replyTarget ? getCommentReplyLabel(replyTarget) : '';
    const replySnippet = replyTarget?.text ? String(replyTarget.text).trim() : '';
    const isHighlighted = highlightedCommentId === comment.id;
    const moderationLabel = getCommentModerationLabel(comment);
    const moderationHint = getCommentModerationHint(comment);
    const isVisible = isCommentVisible(comment);
    const canOpenAuthor = Number(comment?.author?.id || 0) > 0;
    const authorName = formatCommentAuthorName(comment.author);
    const replyCount = (repliesByRootId.get(Number(comment.id || 0)) || []).length;
    const socialSignals = getCommentSocialSignals(comment, {
      postAuthorId: Number(commentPost?.author?.id || 0),
      replyCount,
    });
    const canExpandText = isVisible && isCommentTextLong(comment.text);
    const textExpanded = Boolean(expandedCommentBodies[comment.id]);
    const commentBody = canExpandText && !textExpanded ? getCollapsedCommentText(comment.text) : comment.text;

    const primarySignals = socialSignals.slice(0, 2);
    return (
      <article
        className={`comment-card comment-card-flat ${nested ? 'comment-card-nested' : ''} ${isHighlighted ? 'comment-card-highlighted' : ''} ${isVisible ? '' : 'comment-card-moderated'}`}
        key={comment.id}
        ref={(node) => {
          if (node) commentElementRefs.current.set(comment.id, node);
          else commentElementRefs.current.delete(comment.id);
        }}
      >
        <div className="comment-card-shell">
          {canOpenAuthor ? (
            <button type="button" className="comment-avatar comment-avatar-btn" onClick={() => openProfile(comment.author)} aria-label="Открыть профиль автора комментария">{getCommentInitial(comment)}</button>
          ) : (
            <div className="comment-avatar comment-avatar-btn is-muted" aria-hidden="true">{getCommentInitial(comment)}</div>
          )}
          <div className="comment-content">
            <div className="comment-header">
              <div className="comment-headerMain">
                {canOpenAuthor ? (
                  <button type="button" className="comment-author-row comment-author-btn" onClick={() => openProfile(comment.author)}>
                    <span className="comment-author-name">{authorName}</span>
                  </button>
                ) : (
                  <div className="comment-author-row">
                    <span className="comment-author-name is-muted">{authorName}</span>
                  </div>
                )}
                <div className="comment-headerMetaLine">
                  {replyTarget ? (
                    <button type="button" className="comment-inlineReply" onClick={() => focusCommentById(replyTarget.id)}>
                      {replyLabel}
                    </button>
                  ) : null}
                  <span className="comment-date">{getCommentMeta(comment)}</span>
                </div>
              </div>
              <div className={`comment-menuWrap ${menuOpen ? 'open' : ''}`} onClick={(event) => event.stopPropagation()}>
                <button type="button" className="comment-menuBtn" aria-label="Действия с комментарием" onClick={() => setCommentMenuId((prev) => prev === comment.id ? null : comment.id)}>⋯</button>
                <div className="comment-menuDropdown">
                  {comment.moderation?.can_reply ? <button type="button" className="comment-menuItem" onClick={() => handleCommentReply(comment)}>Ответить</button> : null}
                  {comment.moderation?.can_copy ? <button type="button" className="comment-menuItem" onClick={() => handleCommentCopy(comment)}>Скопировать</button> : null}
                  {comment.moderation?.can_edit ? <button type="button" className="comment-menuItem" onClick={() => handleCommentEdit(comment)} disabled={busy === `comment-edit:${comment.id}`}>Изменить</button> : null}
                  {comment.moderation?.can_report ? <button type="button" className="comment-menuItem" onClick={() => handleCommentReport(comment)} disabled={busy === `comment-report:${comment.id}`}>Пожаловаться</button> : null}
                  {comment.moderation?.reported_by_me && !comment.moderation?.can_report ? <button type="button" className="comment-menuItem" disabled>Жалоба отправлена</button> : null}
                  {comment.moderation?.can_delete ? <button type="button" className="comment-menuItem is-danger" onClick={() => handleCommentDelete(comment)} disabled={busy === `comment-delete:${comment.id}`}>Удалить</button> : null}
                </div>
              </div>
            </div>
            <div className={`comment-text ${isVisible ? '' : 'is-muted'} ${canExpandText && !textExpanded ? 'is-collapsed' : ''}`}>{commentBody}</div>
            {canExpandText ? (
              <button type="button" className="comment-expandBtn" onClick={() => setExpandedCommentBodies((prev) => ({ ...prev, [comment.id]: !prev[comment.id] }))}>
                {textExpanded ? 'Свернуть' : 'Читать полностью'}
              </button>
            ) : null}
            {replyTarget && replySnippet ? (
              <button type="button" className="comment-replyReference comment-replyReference-inline" onClick={() => focusCommentById(replyTarget.id)}>
                <span className="comment-replyReferenceText">{replySnippet}</span>
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
                    disabled={busy === `comment-vote:${comment.id}`}
                    onClick={() => handleCommentVote(comment.id, comment.current_vote === 1 ? 0 : 1)}
                  >
                    <svg viewBox="0 0 24 24"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
                    <span>{Number(comment?.stats?.plus || 0)}</span>
                  </button>
                  <button
                    className={`comment-voteBtn is-minus ${comment.current_vote === -1 ? 'active' : ''}`}
                    type="button"
                    aria-label="Поставить минус комментарию"
                    disabled={busy === `comment-vote:${comment.id}`}
                    onClick={() => handleCommentVote(comment.id, comment.current_vote === -1 ? 0 : -1)}
                  >
                    <svg viewBox="0 0 24 24"><path d="M5 12h14"></path></svg>
                    <span>{Number(comment?.stats?.minus || 0)}</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </article>
    );
  };

  const renderPostLayer = (post) => {
    const isTextOpenForPost = Number(fullTextPost?.id || 0) === Number(post?.id || 0);
    const isCommentsOpenForPost = Number(commentPost?.id || 0) === Number(post?.id || 0);
    const isShareOpenForPost = Number(shareSheetPost?.id || 0) === Number(post?.id || 0);
    if (!isTextOpenForPost && !isCommentsOpenForPost && !isShareOpenForPost) return null;

    return (
      <>
        {isTextOpenForPost ? <PostTextSheet post={fullTextPost} onClose={() => setFullTextPost(null)} /> : null}
        {isShareOpenForPost ? (
          <RepostSheet
            post={shareSheetPost}
            onClose={closeShareSheet}
            onRepostResult={(data, target) => {
              if (data?.original_post) patchPostSnapshot(data.original_post.id, data.original_post);
              if (data?.post && target?.targetType !== 'community') upsertPostSnapshot(data.post, { prepend: true });
              showToast(data?.already_exists ? 'Репост уже есть в профиле.' : 'Репост создан.', 'success');
            }}
            onChatShareResult={(data) => {
              if (data?.post && shareSheetPost) patchPostSnapshot(shareSheetPost.id, data.post);
              showToast('Публикация отправлена в чат.', 'success');
            }}
            onSaveToggle={(postId) => handleToggleSave(postId)}
          />
        ) : null}
        {isCommentsOpenForPost ? (
          <BaseBottomSheet
            open={isCommentsOpenForPost}
            title="Комментарии"
            subtitle={`${currentComments.length} ${getCountWord(currentComments.length, ['комментарий', 'комментария', 'комментариев'])}`}
            onClose={() => { setCommentPostId(null); setCommentReplyTarget(null); setCommentMenuId(null); setCommentComposerError(''); setCommentLoadError(''); }}
            className="feedV2-commentSheet"
            scope="post"
            contentClassName={`comment-list comment-list-flat ${commentLoading ? 'is-loading' : ''}`}
            sheetRef={commentSheetRef}
            contentRef={commentListRef}
            titleId="feed-comments-title"
            style={commentPost ? {
              '--comment-sheet-keyboard-offset': `${commentSheetKeyboardInset}px`,
              transform: `translateY(${commentSheetDragOffset}px)`,
            } : undefined}
            onSheetClick={(event) => { event.stopPropagation(); setCommentMenuId(null); }}
            dragHandlers={{
              onTouchStart: handleCommentSheetTouchStart,
              onTouchMove: handleCommentSheetTouchMove,
              onTouchEnd: handleCommentSheetTouchEnd,
            }}
            footer={(
              <div className="comment-composer comment-composer-flat">
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
                    className="comment-input comment-input-flat"
                    placeholder={getCommentComposerPlaceholder(commentPost, commentReplyTarget)}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onFocus={() => {
                      window.setTimeout(() => {
                        const node = commentTextareaRef.current;
                        node?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                      }, 80);
                    }}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                        event.preventDefault();
                        addComment();
                      }
                    }}
                    rows={1}
                  />
                  <button className="comment-composer-btn comment-composerSend" type="button" onClick={addComment} disabled={busy === 'comment' || !buildCommentText(commentText)} aria-label={busy === 'comment' ? 'Отправляем комментарий' : 'Отправить комментарий'}>
                    {busy === 'comment' ? (
                      <span className="comment-sendSpinner" aria-hidden="true" />
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-4 16-4-7-8-1z"></path><path d="m12 13 8-9"></path></svg>
                    )}
                  </button>
                </div>
                <div className={`comment-composerMeta ${commentComposerError ? 'is-error' : commentSlowState ? 'is-warning' : hasCommentDraft ? 'is-draft' : ''}`}>
                  <span className="comment-composerState">{commentComposerStateLabel || 'Комментарий увидят все, у кого есть доступ к посту'}</span>
                  {commentComposerError ? <button type="button" className="comment-composerMetaBtn" onClick={addComment}>Повторить</button> : null}
                </div>
              </div>
            )}
          >
            {commentLoading ? (
              <div className="comment-loadingList">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="comment-loadingCard">
                    <div className="comment-loadingAvatar"></div>
                    <div className="comment-loadingLines">
                      <span className="comment-loadingLine is-short"></span>
                      <span className="comment-loadingLine"></span>
                      <span className="comment-loadingLine is-shorter"></span>
                    </div>
                  </div>
                ))}
              </div>
            ) : commentLoadError ? (
              <div className="comment-stateCard is-error">
                <div className="comment-stateTitle">Не удалось открыть комментарии</div>
                <div className="comment-stateText">{commentLoadError}</div>
                <button type="button" className="comment-stateBtn" onClick={() => openComments(commentPostId)}>Повторить</button>
              </div>
            ) : sortedTopLevelComments.length ? (
              <>
                {visibleTopLevelComments.map((comment) => {
                  const rootId = Number(comment.id || 0);
                  const replies = repliesByRootId.get(rootId) || [];
                  const repliesExpanded = Boolean(expandedReplyRoots[rootId]);
                  return (
                    <div className="comment-threadGroup" key={comment.id}>
                      {renderCommentCard(comment)}
                      {replies.length ? (
                        <div className="comment-threadMeta">
                          <button
                            type="button"
                            className="comment-threadToggle"
                            onClick={() => setExpandedReplyRoots((prev) => ({ ...prev, [rootId]: !prev[rootId] }))}
                          >
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
                })}
                {remainingCommentThreads > 0 ? (
                  <div className="comment-loadMoreRow">
                    <button type="button" className="comment-loadMoreBtn" onClick={() => setVisibleCommentRoots((prev) => prev + 6)}>
                      Показать ещё {remainingCommentThreads}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="comment-emptyInline">
                <div className="comment-emptyTitle">Будьте первым, кто ответит</div>
                <div className="comment-emptyText">Комментарии появятся здесь, внутри этой публикации.</div>
              </div>
            )}
          </BaseBottomSheet>
        ) : null}
      </>
    );
  };

  return (
    <div className="app-shell">
      <div className={`app profile-app ${contentMode === 'videos' ? 'feedV2-appVideo' : ''}`}>
        <div className={`screen feed-screen feedV2-screen feedV2-readOnly active ${contentMode === 'videos' ? 'feedV2-videoMode' : ''} ${settingsOpen ? 'is-settings-open' : ''} ${commentPostId ? 'is-comments-open' : ''} ${isPostSheetOpen ? 'is-post-sheet-open' : ''}`}>
          <header className="feedV2-topbar glass">
            <div className="feedV2-topRow">
              <div className="feedV2-modeSwitch" role="tablist" aria-label="Тип ленты" data-mode={contentMode} onKeyDown={handleContentModeKeyDown}>
                <button
                  type="button"
                  role="tab"
                  className={`feedV2-modeBtn ${contentMode === 'posts' ? 'active' : ''}`}
                  aria-selected={contentMode === 'posts'}
                  aria-controls="feed-v2-posts"
                  tabIndex={contentMode === 'posts' ? 0 : -1}
                  onClick={() => handleContentModeChange('posts')}
                >
                  <span className="feedV2-modeLabel">Посты</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`feedV2-modeBtn ${contentMode === 'videos' ? 'active' : ''}`}
                  aria-selected={contentMode === 'videos'}
                  aria-controls="feed-v2-videos"
                  tabIndex={contentMode === 'videos' ? 0 : -1}
                  onClick={() => handleContentModeChange('videos')}
                >
                  <span className="feedV2-modeLabel">Видео</span>
                </button>
              </div>
              <span className="feedV2-modeLive" aria-live="polite">{contentMode === 'videos' ? 'Включена видеолента' : 'Включена лента постов'}</span>
              <button className="feedV2-prefsChip" type="button" aria-label="Настроить ленту" onClick={openFeedSettings}>
                {getFeedTabLabel(activeChip)} · {getFeedOrderShortLabel(feedSettings.sort_mode)}
              </button>
              <button
                className={`feedV8-refreshBtn ${refreshing ? 'is-loading' : ''}`}
                type="button"
                aria-label="Обновить ленту"
                disabled={loading || refreshing}
                onClick={() => loadFeed({ silent: true, feedback: true })}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.4 6.4"></path><path d="M3 12A9 9 0 0 1 18.4 5.6"></path><path d="M18 2v4h-4"></path><path d="M6 22v-4h4"></path></svg>
              </button>
              <NotificationCenter buttonClassName="icon-btn notifications-btn feedV2-notificationsBtn" />
            </div>
          </header>

          {(isOffline || refreshing) ? (
            <div className={`feedV8-statusBar ${isOffline ? 'is-offline' : 'is-refreshing'}`} role="status">
              <span>{isOffline ? 'Нет соединения · показываем доступные посты' : 'Обновляем ленту…'}</span>
            </div>
          ) : null}

          {loading ? (
            <section className={`feedV2-skeletonList ${contentMode === 'videos' ? 'feedV8-videoSkeleton' : ''}`} aria-label="Загружаем ленту" aria-busy="true">
              {[0, 1, 2].map((item) => (
                <article className="feedV2-skeletonCard" key={item}>
                  <div className="feedV2-skeletonHead">
                    <span className="feedV2-skeletonAvatar" />
                    <span className="feedV2-skeletonLine is-short" />
                  </div>
                  <div className="feedV2-skeletonMedia" />
                  <span className="feedV2-skeletonLine" />
                  <span className="feedV2-skeletonLine is-mid" />
                </article>
              ))}
            </section>
          ) : error ? (
            <div className="feedN-empty feedV2-empty feedV2-errorState">
              <div className="feedV2-emptyKicker">Лента</div>
              <div className="feedV2-emptyTitle">Не удалось обновить ленту</div>
              <div className="feedV2-emptyText">{error}</div>
              <div className="feedV2-emptyActions">
                <button className="feedV2-emptyBtn" type="button" onClick={() => loadFeed()}>Повторить</button>
              </div>
            </div>
          ) : visiblePosts.length === 0 ? (
            <div className="feedN-empty feedV2-empty">
              {emptyState.kicker ? <div className="feedV2-emptyKicker">{emptyState.kicker}</div> : null}
              <div className="feedV2-emptyTitle">{emptyState.title}</div>
              <div className="feedV2-emptyText">{emptyState.text}</div>
              {emptyState.actions.length ? (
                <div className="feedV2-emptyActions">
                  {emptyState.actions.map((action) => (
                    <button
                      key={action.id}
                      className={`feedV2-emptyBtn ${action.ghost ? 'feedV2-emptyBtnGhost' : ''}`}
                      type="button"
                      onClick={() => handleEmptyAction(action.id)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <section
              ref={feedListRef}
              id={contentMode === 'videos' ? 'feed-v2-videos' : 'feed-v2-posts'}
              className={`feed-list feedV2-list ${contentMode === 'videos' ? 'feedV2-listVideo' : ''} ${isPostSheetOpen ? 'feedV9-listLocked feedV10-listLocked' : ''}`}
              aria-label={contentMode === 'videos' ? 'Видеолента' : 'Лента постов'}
              aria-hidden={settingsOpen ? 'true' : undefined}
              data-interaction-locked={isPostSheetOpen ? activePostSheetKind : undefined}
              onPointerDownCapture={guardFeedGestureWhileSheetOpen}
              onPointerMoveCapture={guardFeedGestureWhileSheetOpen}
              onTouchStartCapture={guardFeedGestureWhileSheetOpen}
              onTouchMoveCapture={guardFeedGestureWhileSheetOpen}
              onWheelCapture={guardFeedGestureWhileSheetOpen}
            >
              {visiblePosts.map((post) => (
                <div className={`feedV2-item ${contentMode === 'videos' ? 'feedV2-itemVideo' : ''}`} key={post.id}>
                  <FeedPost
                    post={post}
                    onOpenComments={openComments}
                    onOpenFullText={setFullTextPost}
                    onOpenProfile={openProfile}
                    onOpenCommunity={openCommunity}
                    onVote={handleVote}
                    onToggleLike={handleToggleLike}
                    onToggleSave={handleToggleSave}
                    onReport={handleReportPost}
                    onShare={handleSharePost}
                    onEdit={handleEditPost}
                    onDelete={handleDeletePost}
                    actionBusyKey={busy}
                    saveFeedbackLabel={Number(saveFeedback?.postId || 0) === Number(post.id) ? saveFeedback.label : ''}
                    sheetSlot={renderPostLayer(post)}
                  />
                </div>
              ))}
            </section>
          )}
        </div>

        <PostAuthBottomNav current="feed" />
      </div>

      <div className={`notifications-overlay ${settingsOpen ? 'open' : ''}`} onClick={closeFeedSettings} onWheel={(event) => event.preventDefault()} onTouchMove={(event) => event.preventDefault()}></div>
      <aside ref={feedSettingsSheetRef} className={`notifications-sheet feed-settings-sheet ${settingsOpen ? 'open' : ''}`} role="dialog" aria-modal={settingsOpen ? 'true' : undefined} aria-labelledby="feed-settings-title" aria-hidden={!settingsOpen} tabIndex={-1}>
        <div className="notifications-head">
          <div>
            <div className="notifications-title" id="feed-settings-title">Настройки ленты</div>
            <div className="feed-settings-subtitle">Источник и порядок — внутри, без лишних панелей на карточке.</div>
          </div>
          <button className="ghost-btn" type="button" onClick={closeFeedSettings}>Закрыть</button>
        </div>

        <div className="feed-settings-list">
          <section className="feed-settings-card">
            <div className="feed-settings-card-title">Источник</div>
            <div className="feed-settings-source-grid">
              {FEED_SOURCE_OPTIONS.map((source) => (
                <button
                  key={source.id}
                  className={`feed-settings-source ${normalizeFeedSource(settingsDraft.default_tab) === source.id ? 'active' : ''}`}
                  type="button"
                  aria-pressed={normalizeFeedSource(settingsDraft.default_tab) === source.id}
                  onClick={() => setSettingsDraft((prev) => ({
                    ...prev,
                    default_tab: source.id,
                    show_friends: true,
                    show_following: true,
                    show_global: true,
                  }))}
                >
                  <span>{source.label}</span>
                  <small>{source.hint}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="feed-settings-card">
            <div className="feed-settings-card-title">Порядок</div>
            <div className="feed-settings-orderGrid">
              <button
                className={`feed-settings-order ${getFeedOrderMode(settingsDraft.sort_mode) === 'recent' ? 'active' : ''}`}
                type="button"
                aria-pressed={getFeedOrderMode(settingsDraft.sort_mode) === 'recent'}
                onClick={() => setSettingsDraft((prev) => ({ ...prev, sort_mode: 'recent' }))}
              >
                <span>Сначала новые</span>
                <small>Свежие публикации идут первыми.</small>
              </button>
              <button
                className={`feed-settings-order ${getFeedOrderMode(settingsDraft.sort_mode) === 'popular' ? 'active' : ''}`}
                type="button"
                aria-pressed={getFeedOrderMode(settingsDraft.sort_mode) === 'popular'}
                onClick={() => setSettingsDraft((prev) => ({ ...prev, sort_mode: 'popular' }))}
              >
                <span>Рекомендации</span>
                <small>Сначала активные и свежие публикации. Без лишних объяснений на карточках.</small>
              </button>
            </div>
          </section>

        </div>

        <div className="feed-settings-actions">
          <button className="ghost-btn" type="button" onClick={() => setSettingsDraft(feedSettings)} disabled={savingSettings}>Сбросить</button>
          <button className="feed-settings-save" type="button" onClick={saveFeedSettings} disabled={savingSettings}>{savingSettings ? 'Сохраняем...' : 'Сохранить'}</button>
        </div>
      </aside>


      {toast ? (
        <div className={`feedV8-toast is-${toast.tone}`} role="status" aria-live="polite">
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Закрыть уведомление">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"></path><path d="M18 6 6 18"></path></svg>
          </button>
        </div>
      ) : null}

      <MinimalActionDialog {...actionDialog.dialogProps} />
    </div>
  );
}

'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PostAuthBottomNav from '../../components/PostAuthBottomNav';
import StoriesFoundationRail from '@/components/StoriesFoundationRail';
import { mapStoryToRailItem } from '@/lib/stories-foundation';
import { readPageCache, writePageCache } from '@/lib/page-cache';
import { buildCommentThreadData, formatCommentAuthorName, getCollapsedCommentText, getCommentAuthorInitial, getCommentModerationHint, getCommentModerationLabel, getCommentModerationTone, getCommentReplyTarget, getCommentRootId, getCommentSocialSignals, getCommentSortLabel, getCommentThreadToggleLabel, getRemainingCommentThreadCount, isCommentTextLong, isCommentVisible, normalizeCommentDraft, sortCommentThreads } from '@/lib/comments-client';

const defaultFeedSettings = {
  default_tab: 'following',
  sort_mode: 'recent',
  show_friends: true,
  show_following: true,
  show_global: true,
  saved_first: false,
};

const FEED_CACHE_KEY = 'page:feed';
const FEED_CACHE_TTL = 2 * 60 * 1000;
const COMMENT_DRAFT_KEY_PREFIX = 'friendscape:feed-comment-draft:';

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


function mapNotificationItem(item) {
  return {
    id: item.id,
    author: item.actor?.name || 'Система',
    text: item.text,
    target: item.target || '',
    time: item.time || formatTime(item.created_at),
    unread: Boolean(item.unread),
  };
}

function BellIcon() {
  return <svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"></path><path d="M10 20a2 2 0 0 0 4 0"></path></svg>;
}
function SearchIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>;
}
function SlidersIcon() {
  return <svg viewBox="0 0 24 24"><path d="M4 6h8"></path><path d="M16 6h4"></path><circle cx="14" cy="6" r="2"></circle><path d="M4 12h4"></path><path d="M12 12h8"></path><circle cx="10" cy="12" r="2"></circle><path d="M4 18h10"></path><path d="M18 18h2"></path><circle cx="16" cy="18" r="2"></circle></svg>;
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

function buildCommentText(text) {
  return normalizeCommentDraft(text);
}

function getCommentMeta(comment) {
  return `${formatTime(comment.created_at)}${comment.edited ? ' · изм.' : ''}`;
}

function getCommentInitial(comment) {
  return getCommentAuthorInitial(comment?.author || null);
}

function getCommentLikeCount(comment) {
  return Number(comment?.stats?.plus || 0);
}

function getCommentScoreLabel(comment) {
  const plus = Number(comment?.stats?.plus || 0);
  const minus = Number(comment?.stats?.minus || 0);
  if (minus <= 0) return '';
  return `Спорно · −${minus}`;
}

function getCommentReplyLabel(comment) {
  const author = formatCommentAuthorName(comment?.author || null);
  return author ? `Ответ ${author}` : 'Ответ';
}

function getCommentComposerPlaceholder(post, replyTarget) {
  if (replyTarget) return 'Ответить';
  return 'Написать комментарий';
}

function getCommentCopyText(comment) {
  if (!comment?.moderation?.can_copy) return '';
  return String(comment?.raw_text || comment?.text || '').trim();
}

function getAvailableTabs(settings) {
  const tabs = [];
  if (settings.show_friends) tabs.push('friends');
  if (settings.show_following) tabs.push('following');
  if (settings.show_global) tabs.push('global');
  return tabs.length ? tabs : ['following'];
}

function normalizeSettings(input) {
  return {
    ...defaultFeedSettings,
    ...(input && typeof input === 'object' ? input : {}),
  };
}

function getPopularityScore(post) {
  return (
    Number(post?.stats?.plus || 0) * 3
    - Number(post?.stats?.minus || 0) * 2
    + Number(post?.stats?.comments || 0) * 2
    + Number(post?.stats?.reposts || 0)
    + Number(post?.stats?.saves || 0)
  );
}

function FeedPost({ post, onOpenComments, onOpenProfile, onVote, onToggleLike, onToggleSave, onReport, onShare, actionBusyKey }) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const payload = post.payload || {};

  return (
    <article className="feed-post-card feed-page-card" onClick={() => menuOpen && setMenuOpen(false)}>
      {payload.reason ? <div className="feed-reason">{payload.reason}</div> : null}
      <div className="feed-post-header">
        <button
          type="button"
          className="feed-post-user feed-post-userBtn"
          onClick={() => onOpenProfile?.(post.author)}
        >
          <div className="feed-post-avatar">{post.author.first_name?.charAt(0) || 'F'}</div>
          <div className="feed-post-user-info">
            <div className="feed-post-name">{formatName(post.author)}</div>
            <div className="feed-post-meta">{payload.meta || `${formatTime(post.created_at)}${post.location ? ` · ${post.location}` : ''}`}</div>
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
            <button className="feed-post-menu-btn" type="button" onClick={() => { setMenuOpen(false); onReport(post.id); }}>Пожаловаться</button>
          </div>
        </div>
      </div>

      <div className="feed-post-text-wrap">
        <div className={`feed-post-text ${expanded ? '' : 'collapsed'}`}>{post.text}</div>
        <button className="feed-post-more-btn" type="button" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Скрыть' : 'Ещё'}</button>
      </div>

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

      {post.type === 'link' && (
        <div className="feed-post-content-block feed-post-link-card is-active">
          <div className="link-domain">{payload.domain}</div>
          <div className="feed-post-link-title">{payload.title}</div>
          <div className="feed-post-link-desc">{payload.desc}</div>
        </div>
      )}

      {post.type === 'repost' && (
        <div className="feed-post-content-block feed-post-repost-card is-active">
          <div className="feed-post-repost-title">{payload.title}</div>
          <div className="feed-post-repost-desc">{payload.desc}</div>
          <div className="repost-inner">
            <div className="feed-post-link-title">{payload.innerTitle}</div>
            <div className="feed-post-link-desc">{payload.innerDesc}</div>
          </div>
        </div>
      )}

      <div className="feed-post-footer">
        <div className="feed-post-rating">
          <div className="vote-group">
            <button className={`vote-btn plus ${post.current_vote === 1 ? 'active' : ''}`} type="button" aria-label="Плюс" disabled={actionBusyKey === `vote:${post.id}` || actionBusyKey === `like:${post.id}`} onClick={() => onVote(post.id, post.current_vote === 1 ? 0 : 1)}>
              <svg viewBox="0 0 24 24"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
            </button>
            <div className="vote-count">{post.stats.plus}</div>
          </div>
          <div className="vote-group">
            <button className={`vote-btn minus ${post.current_vote === -1 ? 'active' : ''}`} type="button" aria-label="Минус" disabled={actionBusyKey === `vote:${post.id}` || actionBusyKey === `like:${post.id}`} onClick={() => onVote(post.id, post.current_vote === -1 ? 0 : -1)}>
              <svg viewBox="0 0 24 24"><path d="M5 12h14"></path></svg>
            </button>
            <div className="vote-count vote-count-minus">{post.stats.minus}</div>
          </div>
        </div>
        <div className="feed-post-social">
          <div className="views-chip">
            <svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            <span>{post.stats.views}</span>
          </div>
          <button className={`social-btn like-btn ${post.is_liked ? 'active' : ''}`} type="button" aria-label={post.is_liked ? 'Убрать лайк' : 'Нравится'} disabled={actionBusyKey === `like:${post.id}` || actionBusyKey === `vote:${post.id}`} onClick={() => onToggleLike(post)}>
            <svg viewBox="0 0 24 24"><path d="m12 20-1.1-1C6.14 14.24 3 11.39 3 7.86A4.86 4.86 0 0 1 7.86 3c1.76 0 3.45.82 4.14 2.09A4.83 4.83 0 0 1 16.14 3 4.86 4.86 0 0 1 21 7.86c0 3.53-3.14 6.38-7.9 11.13L12 20z"></path></svg>
            <span>{post.is_liked ? 'Нравится' : 'Лайк'}</span>
          </button>
          <button className="social-btn comments-btn" type="button" aria-label="Комментарии" onClick={() => onOpenComments(post.id)}>
            <svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.53-.29-3.62-.8L3 21l1.92-5.38A8.47 8.47 0 0 1 4 11.5 8.5 8.5 0 1 1 21 11.5z"></path></svg>
            <span>{post.stats.comments}</span>
          </button>
          <button className="social-btn repost-btn" type="button" aria-label="Поделиться" onClick={() => onShare?.(post, 'share')}>
            <svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14"></path><path d="M16 6l4 4-4 4"></path><path d="M20 10H9a5 5 0 0 0-5 5"></path></svg>
            <span>{post.stats.reposts}</span>
          </button>
          <button className={`social-btn save-btn ${post.is_saved ? 'active' : ''}`} type="button" aria-label="Сохранить" disabled={actionBusyKey === `save:${post.id}`} onClick={() => onToggleSave(post.id)}>
            <svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"></path></svg>
            <span>{post.is_saved ? 'Сохранено' : 'Сохранить'}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

export default function FeedPage() {
  const router = useRouter();
  const initialCacheRef = useRef(null);
  const [activeChip, setActiveChip] = useState('following');
  const [feedSettings, setFeedSettings] = useState(normalizeSettings());
  const [settingsDraft, setSettingsDraft] = useState(normalizeSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsList, setNotificationsList] = useState([]);
  const [notificationsUnreadCount, setNotificationsUnreadCount] = useState(0);
  const [posts, setPosts] = useState([]);
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
  const [storyRailItems, setStoryRailItems] = useState([]);
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

  const openProfile = useCallback((author) => {
    const authorId = Number(author?.id || 0);
    if (!authorId) return;
    router.push(`/profile/${authorId}?from=feed`);
  }, [router]);

  useLayoutEffect(() => {
    const cachedState = readPageCache(FEED_CACHE_KEY, FEED_CACHE_TTL);
    initialCacheRef.current = cachedState;
    if (!cachedState) return;
    setActiveChip(cachedState.activeChip || 'following');
    setFeedSettings(normalizeSettings(cachedState.feedSettings));
    setSettingsDraft(normalizeSettings(cachedState.settingsDraft || cachedState.feedSettings));
    const cachedNotifications = Array.isArray(cachedState.notificationsList) ? cachedState.notificationsList : [];
    setNotificationsList(cachedNotifications);
    setNotificationsUnreadCount(Number(cachedState.notificationsUnreadCount ?? cachedNotifications.filter((item) => item?.unread).length));
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

  const availableTabs = useMemo(() => getAvailableTabs(feedSettings), [feedSettings]);

  const loadFeed = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
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
    } catch (loadError) {
      setError(loadError.message || 'Не удалось загрузить ленту.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications?limit=20', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить уведомления.');
      const items = Array.isArray(data.items) ? data.items.map(mapNotificationItem) : [];
      setNotificationsList(items);
      setNotificationsUnreadCount(Number(data.unreadCount ?? items.filter((item) => item.unread).length));
    } catch (loadError) {
      console.error('notifications load failed', loadError);
    }
  }, []);

  useEffect(() => {
    const hasWarmCache = Boolean(initialCacheRef.current);
    loadFeed({ silent: hasWarmCache });
    if (!initialCacheRef.current?.notificationsList?.length) {
      loadNotifications();
    }
  }, [loadFeed, loadNotifications]);

  useEffect(() => {
    if (!posts.length && !notificationsList.length && loading) return;
    writePageCache(FEED_CACHE_KEY, {
      activeChip,
      feedSettings,
      settingsDraft,
      notificationsList,
      notificationsUnreadCount,
      posts,
    });
  }, [activeChip, feedSettings, settingsDraft, notificationsList, notificationsUnreadCount, posts, loading]);

  useEffect(() => {
    if (!availableTabs.includes(activeChip)) {
      setActiveChip(availableTabs[0]);
    }
  }, [activeChip, availableTabs]);

  useEffect(() => {
    if (notificationsOpen) {
      loadNotifications();
    }
  }, [notificationsOpen, loadNotifications]);

  useEffect(() => {
    const hasOverlayOpen = Boolean(notificationsOpen || settingsOpen || commentPostId);
    const hasBlockingOverlay = Boolean(notificationsOpen || settingsOpen);
    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;
    if (hasOverlayOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = hasBlockingOverlay ? 'none' : '';
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
    };
  }, [commentPostId, notificationsOpen, settingsOpen]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (commentPostId) {
        setCommentPostId(null);
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (notificationsOpen) {
        setNotificationsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commentPostId, notificationsOpen, settingsOpen]);

  useEffect(() => {
    if (!commentPostId) return;
    setCommentPostId(null);
    setCommentText('');
    setCommentReplyTarget(null);
    setCommentMenuId(null);
  }, [activeChip, search]);

  useEffect(() => {
    if (!settingsOpen) return;
    setNotificationsOpen(false);
  }, [settingsOpen]);

  useEffect(() => {
    if (!notificationsOpen) return;
    setSettingsOpen(false);
  }, [notificationsOpen]);

  useEffect(() => {
    if (!(settingsOpen || notificationsOpen)) return;
    if (commentPostId) setCommentPostId(null);
  }, [commentPostId, notificationsOpen, settingsOpen]);

  useEffect(() => {
    const eventSource = new EventSource('/api/realtime/stream');

    const onNotificationCreated = (evt) => {
      try {
        const payload = JSON.parse(evt.data || '{}');
        if (typeof payload?.unread_count === 'number') setNotificationsUnreadCount(Number(payload.unread_count || 0));
        if (payload?.item) {
          const item = mapNotificationItem(payload.item);
          setNotificationsList((prev) => {
            const next = [item, ...prev.filter((entry) => entry.id !== item.id)];
            return next.slice(0, 20);
          });
        }
      } catch {}
    };

    const onNotificationRead = (evt) => {
      try {
        const payload = JSON.parse(evt.data || '{}');
        if (typeof payload?.unread_count === 'number') setNotificationsUnreadCount(Number(payload.unread_count || 0));
        if (payload?.item) {
          const item = mapNotificationItem(payload.item);
          setNotificationsList((prev) => prev.map((entry) => (entry.id === item.id ? item : entry)));
        }
      } catch {}
    };

    const onNotificationReadAll = (evt) => {
      try {
        const payload = JSON.parse(evt.data || '{}');
        setNotificationsList((prev) => prev.map((item) => ({ ...item, unread: false })));
        setNotificationsUnreadCount(Number(payload?.unreadCount || 0));
      } catch {}
    };

    const onSyncUnread = (evt) => {
      try {
        const payload = JSON.parse(evt.data || '{}');
        if (typeof payload?.notifications_unread === 'number') setNotificationsUnreadCount(Number(payload.notifications_unread || 0));
      } catch {}
    };

    eventSource.addEventListener('notification.created', onNotificationCreated);
    eventSource.addEventListener('notification.read', onNotificationRead);
    eventSource.addEventListener('notification.read_all', onNotificationReadAll);
    eventSource.addEventListener('sync.unread', onSyncUnread);
    eventSource.onerror = () => {};

    return () => {
      eventSource.removeEventListener('notification.created', onNotificationCreated);
      eventSource.removeEventListener('notification.read', onNotificationRead);
      eventSource.removeEventListener('notification.read_all', onNotificationReadAll);
      eventSource.removeEventListener('sync.unread', onSyncUnread);
      eventSource.close();
    };
  }, []);

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

  const visiblePosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = posts.filter((post) => {
      const payload = post.payload || {};
      const channel = payload.feedChannel || 'following';
      const chipMatch = activeChip === 'global' ? channel === 'global' : activeChip === 'friends' ? channel === 'friends' : channel === 'following';
      if (!chipMatch) return false;
      if (settingsDraft.saved_first && !post.is_saved) {
        // savedFirst влияет только на сортировку, не на фильтр
      }
      if (!q) return true;
      const haystack = [
        post.text,
        formatName(post.author),
        payload.title,
        payload.desc,
        payload.domain,
        payload.innerTitle,
        payload.innerDesc,
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });

    const sorted = filtered.slice().sort((left, right) => {
      if (feedSettings.saved_first && left.is_saved !== right.is_saved) {
        return left.is_saved ? -1 : 1;
      }
      if (feedSettings.sort_mode === 'popular') {
        const diff = getPopularityScore(right) - getPopularityScore(left);
        if (diff !== 0) return diff;
      }
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });

    return sorted;
  }, [activeChip, feedSettings, posts, search]);

  const unreadCount = notificationsUnreadCount;

  useEffect(() => {
    let cancelled = false;
    const loadStories = async () => {
      try {
        const response = await fetch('/api/stories?source=feed&limit=8', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;
        const nextItems = Array.isArray(data.items)
          ? data.items.map((item) => mapStoryToRailItem(item, 'feed')).filter(Boolean)
          : [];
        if (!cancelled) setStoryRailItems(nextItems);
      } catch {
      }
    };
    loadStories();
    return () => {
      cancelled = true;
    };
  }, []);



  const markNotificationsRead = async () => {
    const previous = notificationsList;
    const previousUnreadCount = notificationsUnreadCount;
    setNotificationsList((prev) => prev.map((item) => ({ ...item, unread: false })));
    setNotificationsUnreadCount(0);
    try {
      const response = await fetch('/api/notifications/read-all', { method: 'PUT' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось отметить уведомления прочитанными.');
    } catch (markError) {
      setNotificationsList(previous);
      setNotificationsUnreadCount(previousUnreadCount);
      setError(markError.message || 'Не удалось отметить уведомления прочитанными.');
    }
  };

  const handleNotificationRead = async (notificationId) => {
    const wasUnread = notificationsList.find((item) => item.id === notificationId)?.unread;
    setNotificationsList((prev) => prev.map((item) => (item.id === notificationId ? { ...item, unread: false } : item)));
    if (wasUnread) setNotificationsUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      const response = await fetch(`/api/notifications/${notificationId}/read`, { method: 'PUT' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось отметить уведомление прочитанным.');
      if (data.item) {
        setNotificationsList((prev) => prev.map((item) => (item.id === notificationId ? mapNotificationItem(data.item) : item)));
        if (typeof data.unread_count === 'number') setNotificationsUnreadCount(Number(data.unread_count || 0));
      }
    } catch (markError) {
      console.error('notification read failed', markError);
      loadNotifications();
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
    try {
      setBusy(`vote:${postId}`);
      const response = await fetch(`/api/feed/posts/${postId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить голос.');
      patchPostSnapshot(postId, data.post);
    } catch (voteError) {
      setError(voteError.message || 'Не удалось обновить голос.');
    } finally {
      setBusy('');
    }
  };

  const handleToggleSave = async (postId) => {
    try {
      setBusy(`save:${postId}`);
      const response = await fetch(`/api/feed/posts/${postId}/save`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить сохранение.');
      patchPostSnapshot(postId, data.post);
    } catch (saveError) {
      setError(saveError.message || 'Не удалось обновить сохранение.');
    } finally {
      setBusy('');
    }
  };

  const handleToggleLike = async (post) => {
    const isLiked = Boolean(post?.is_liked);
    try {
      setBusy(`like:${post.id}`);
      const response = await fetch(`/api/posts/${post.id}/like`, {
        method: isLiked ? 'DELETE' : 'POST',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (isLiked ? 'Не удалось снять лайк.' : 'Не удалось поставить лайк.'));
      patchPostSnapshot(post.id, data.post);
    } catch (likeError) {
      setError(likeError.message || 'Не удалось обновить лайк.');
    } finally {
      setBusy('');
    }
  };

  const openComments = async (postId) => {
    setCommentPostId(postId);
    setCommentReplyTarget(null);
    setCommentMenuId(null);
    setCommentComposerError('');
    setCommentLoadError('');
    setCommentLoading(true);
    try {
      const response = await fetch(`/api/posts/${postId}/comments`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить комментарии.');
      patchCommentsForPost(postId, data.comments || []);
    } catch (loadCommentsError) {
      const nextMessage = loadCommentsError.message || 'Не удалось загрузить комментарии.';
      setError(nextMessage);
      setCommentLoadError(nextMessage);
    } finally {
      setCommentLoading(false);
    }
  };

  const addComment = async () => {
    const text = buildCommentText(commentText);
    if (!text || !commentPostId) return;
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
    } catch (commentError) {
      const nextMessage = commentError.message || 'Не удалось добавить комментарий.';
      setError(nextMessage);
      setCommentComposerError(nextMessage);
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
    const nextText = window.prompt('Изменить комментарий', comment.text || '');
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
    if (!window.confirm('Удалить комментарий?')) return;

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
    const reason = window.prompt('Причина жалобы на комментарий: спам, оскорбление, обман или другое');
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



  const handleReportPost = async (postId) => {
    const reason = window.prompt('Причина жалобы: спам, оскорбление, обман или другое');
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
      window.alert(data.message || 'Жалоба отправлена.');
    } catch (reportError) {
      window.alert(reportError.message || 'Не удалось отправить жалобу.');
    } finally {
      setBusy('');
    }
  };


  const handleSharePost = async (post, mode = 'share') => {
    const postId = Number(post?.id || 0);
    if (!postId || typeof window === 'undefined') return;
    const url = `${window.location.origin}/feed?post=${postId}`;
    const shareTitle = `${formatName(post.author)} · Friendscape`;
    const shareText = String(post?.text || 'Публикация Friendscape').trim().slice(0, 140);
    setInfoMessage('');
    setError('');

    if (mode === 'copy') {
      try {
        await navigator.clipboard.writeText(url);
        setInfoMessage('Ссылка на публикацию скопирована.');
      } catch (_error) {
        setError('Не удалось скопировать ссылку на публикацию.');
      }
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url });
        setInfoMessage('Публикацией поделились.');
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setInfoMessage('Ссылка на публикацию скопирована.');
    } catch (_error) {
      setError('Не удалось скопировать ссылку на публикацию.');
    }
  };

  const saveFeedSettings = async () => {
    try {
      setSavingSettings(true);
      setError('');
      const response = await fetch('/api/feed/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsDraft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить настройки ленты.');
      const nextSettings = normalizeSettings(data.settings);
      setFeedSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setActiveChip(getAvailableTabs(nextSettings).includes(nextSettings.default_tab) ? nextSettings.default_tab : getAvailableTabs(nextSettings)[0]);
      setSettingsOpen(false);
      await loadFeed();
    } catch (settingsError) {
      setError(settingsError.message || 'Не удалось сохранить настройки ленты.');
    } finally {
      setSavingSettings(false);
    }
  };

  const setDraftFlag = (key) => {
    setSettingsDraft((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      const tabs = getAvailableTabs(next);
      if (!tabs.includes(next.default_tab)) {
        next.default_tab = tabs[0];
      }
      return next;
    });
  };

  const renderCommentCard = (comment, nested = false) => {
    const menuOpen = commentMenuId === comment.id;
    const likeActive = comment.current_vote === 1;
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
                <div className="comment-likeRow">
                  <button
                    className={`comment-likeBtn ${likeActive ? 'active' : ''}`}
                    type="button"
                    aria-label="Нравится комментарию"
                    disabled={busy === `comment-vote:${comment.id}`}
                    onClick={() => handleCommentVote(comment.id, likeActive ? 0 : 1)}
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
    <div className="app-shell">
      <div className="app profile-app">
        <div className="screen feed-screen active">
          <header className="topbar glass">
            <div className="topbar-row">
              <div className="title-block">
                <div className="title-main">Лента</div>
                <div className="title-sub">Агрегируемые посты, рекомендации и материалы по интересам</div>
              </div>
              <div className="feed-topbar-actions">
                <button className="icon-btn" type="button" aria-label="Настройки ленты" onClick={() => setSettingsOpen(true)}>
                  <SlidersIcon />
                </button>
                <button className="icon-btn notifications-btn" type="button" aria-label="Уведомления" onClick={() => setNotificationsOpen(true)}>
                  <BellIcon />
                  <span className={`notifications-badge ${unreadCount ? '' : 'is-empty'}`}>{unreadCount}</span>
                </button>
              </div>
            </div>
            <div className="search-wrap">
              <SearchIcon />
              <input className="search-input" placeholder="Поиск по ленте" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </header>

          <div className="chips-row">
            {feedSettings.show_friends ? (
              <button className={`chip friends ${activeChip === 'friends' ? 'active' : ''}`} type="button" onClick={() => setActiveChip('friends')}>Друзья</button>
            ) : null}
            {feedSettings.show_following ? (
              <button className={`chip following ${activeChip === 'following' ? 'active' : ''}`} type="button" onClick={() => setActiveChip('following')}>Подписки</button>
            ) : null}
            {feedSettings.show_global ? (
              <button className={`chip global ${activeChip === 'global' ? 'active' : ''}`} type="button" onClick={() => setActiveChip('global')}>Общая</button>
            ) : null}
          </div>

          <StoriesFoundationRail
            source="feed"
            title="Моменты"
            subtitle="Короткие фото и видео друзей прямо в ленте."
            items={storyRailItems}
          />

          <section className="hero-card glass">
            <div className="hero-top">
              <div>
                <div className="hero-badge">Рекомендации</div>
                <div className="hero-title">Лента осталась просмотровой</div>
                <div className="hero-text">
                  Здесь больше нельзя публиковать свои посты — только смотреть агрегированный поток материалов и взаимодействовать с ним.
                </div>
                <div className="feed-settings-summary">
                  <span className="feed-settings-pill">Вкладка по умолчанию: {feedSettings.default_tab === 'friends' ? 'Друзья' : feedSettings.default_tab === 'global' ? 'Общая' : 'Подписки'}</span>
                  <span className="feed-settings-pill">Сортировка: {feedSettings.sort_mode === 'popular' ? 'Популярное' : 'Сначала новые'}</span>
                  {feedSettings.saved_first ? <span className="feed-settings-pill">Сохранённые выше</span> : null}
                </div>
              </div>
              <div className="hero-orb"></div>
            </div>
          </section>

          <div className="section-caption">
            <strong>Подобрано для вас</strong>
            <span>{visiblePosts.length} материалов</span>
          </div>

          {infoMessage ? <div className="feedN-empty">{infoMessage}</div> : null}
          {error ? <div className="feedN-alert">{error}</div> : null}

          {loading ? (
            <div className="feedN-empty">Загружаем ленту...</div>
          ) : visiblePosts.length === 0 ? (
            <div className="feedN-empty">Ничего не найдено по текущему фильтру и настройкам ленты.</div>
          ) : (
            <section className="feed-list">
              {visiblePosts.map((post) => (
                <FeedPost
                  key={post.id}
                  post={post}
                  onOpenComments={openComments}
                  onOpenProfile={openProfile}
                  onVote={handleVote}
                  onToggleLike={handleToggleLike}
                  onToggleSave={handleToggleSave}
                  onReport={handleReportPost}
                  onShare={handleSharePost}
                  actionBusyKey={busy}
                />
              ))}
            </section>
          )}
        </div>

        <PostAuthBottomNav current="feed" />
      </div>

      <div className={`notifications-overlay ${notificationsOpen ? 'open' : ''}`} onClick={() => setNotificationsOpen(false)}></div>
      <aside className={`notifications-sheet ${notificationsOpen ? 'open' : ''}`} aria-hidden={!notificationsOpen}>
        <div className="notifications-head">
          <div className="notifications-title">Уведомления</div>
          <button className="ghost-btn" type="button" onClick={markNotificationsRead}>Прочитать всё</button>
        </div>
        <div className="notifications-list">
          {notificationsList.length ? notificationsList.map((item) => (
            <button
              className={`notification-item ${item.unread ? 'unread' : ''}`}
              key={item.id}
              type="button"
              onClick={() => handleNotificationRead(item.id)}
            >
              <div className="notification-avatar">{item.author.charAt(0)}</div>
              <div className="notification-main">
                <div className="notification-text"><strong>{item.author}</strong> {item.text}</div>
                {item.target ? <div className="notification-target">{item.target}</div> : null}
                <div className="notification-time">{item.time}</div>
              </div>
            </button>
          )) : (
            <div className="feedN-empty">Пока нет уведомлений.</div>
          )}
        </div>
      </aside>

      <div className={`notifications-overlay ${settingsOpen ? 'open' : ''}`} onClick={() => setSettingsOpen(false)}></div>
      <aside className={`notifications-sheet feed-settings-sheet ${settingsOpen ? 'open' : ''}`} aria-hidden={!settingsOpen}>
        <div className="notifications-head">
          <div>
            <div className="notifications-title">Настройки ленты</div>
            <div className="feed-settings-subtitle">Лента остаётся агрегатором, но теперь можно тонко настроить её ритм и вкладки.</div>
          </div>
          <button className="ghost-btn" type="button" onClick={() => { setSettingsDraft(feedSettings); setSettingsOpen(false); }}>Закрыть</button>
        </div>

        <div className="feed-settings-list">
          <section className="feed-settings-card">
            <div className="feed-settings-card-title">Показывать вкладки</div>
            <div className="feed-settings-toggle-row">
              <button className={`feed-settings-toggle ${settingsDraft.show_friends ? 'active' : ''}`} type="button" onClick={() => setDraftFlag('show_friends')}>Друзья</button>
              <button className={`feed-settings-toggle ${settingsDraft.show_following ? 'active' : ''}`} type="button" onClick={() => setDraftFlag('show_following')}>Подписки</button>
              <button className={`feed-settings-toggle ${settingsDraft.show_global ? 'active' : ''}`} type="button" onClick={() => setDraftFlag('show_global')}>Общая</button>
            </div>
          </section>

          <section className="feed-settings-card">
            <div className="feed-settings-card-title">Вкладка по умолчанию</div>
            <div className="feed-settings-toggle-row">
              {getAvailableTabs(settingsDraft).map((tab) => (
                <button
                  key={tab}
                  className={`feed-settings-toggle ${settingsDraft.default_tab === tab ? 'active' : ''}`}
                  type="button"
                  onClick={() => setSettingsDraft((prev) => ({ ...prev, default_tab: tab }))}
                >
                  {tab === 'friends' ? 'Друзья' : tab === 'global' ? 'Общая' : 'Подписки'}
                </button>
              ))}
            </div>
          </section>

          <section className="feed-settings-card">
            <div className="feed-settings-card-title">Сортировка</div>
            <div className="feed-settings-toggle-row">
              <button className={`feed-settings-toggle ${settingsDraft.sort_mode === 'recent' ? 'active' : ''}`} type="button" onClick={() => setSettingsDraft((prev) => ({ ...prev, sort_mode: 'recent' }))}>Сначала новые</button>
              <button className={`feed-settings-toggle ${settingsDraft.sort_mode === 'popular' ? 'active' : ''}`} type="button" onClick={() => setSettingsDraft((prev) => ({ ...prev, sort_mode: 'popular' }))}>Популярное</button>
            </div>
          </section>

          <section className="feed-settings-card">
            <div className="feed-settings-card-title">Приоритет сохранённых</div>
            <button className={`feed-settings-switch ${settingsDraft.saved_first ? 'active' : ''}`} type="button" onClick={() => setDraftFlag('saved_first')}>
              <span>Поднимать сохранённые выше в текущей подборке</span>
              <strong>{settingsDraft.saved_first ? 'Вкл' : 'Выкл'}</strong>
            </button>
          </section>
        </div>

        <div className="feed-settings-actions">
          <button className="ghost-btn" type="button" onClick={() => setSettingsDraft(feedSettings)} disabled={savingSettings}>Сбросить</button>
          <button className="feed-settings-save" type="button" onClick={saveFeedSettings} disabled={savingSettings}>{savingSettings ? 'Сохраняем...' : 'Сохранить'}</button>
        </div>
      </aside>

      <div className={`global-comment-overlay ${commentPost ? 'open' : ''}`} onClick={() => setCommentPostId(null)}></div>
      <section
        ref={commentSheetRef}
        className={`global-comment-sheet ${commentPost ? 'open' : ''}`}
        style={commentPost ? {
          '--comment-sheet-keyboard-offset': `${commentSheetKeyboardInset}px`,
          transform: `translateX(-50%) translateY(${commentSheetDragOffset}px)`,
        } : undefined}
        onClick={() => setCommentMenuId(null)}
      >
        <div
          className="comment-sheetDragZone"
          onTouchStart={handleCommentSheetTouchStart}
          onTouchMove={handleCommentSheetTouchMove}
          onTouchEnd={handleCommentSheetTouchEnd}
        >
          <div className="comment-sheet-handle"></div>
          <div className="comment-sheet-header">
            <div>
              <div className="comment-sheet-title">Комментарии</div>
              <div className="comment-sheet-meta">{currentComments.length} {currentComments.length === 1 ? 'комментарий' : currentComments.length >= 2 && currentComments.length <= 4 ? 'комментария' : 'комментариев'}</div>
            </div>
            <button className="ghost-btn comment-sheet-closeBtn" type="button" onClick={() => { setCommentPostId(null); setCommentReplyTarget(null); setCommentMenuId(null); setCommentComposerError(''); }}>Закрыть</button>
          </div>
          <div className="comment-sheetControls">
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
        </div>
        <div ref={commentListRef} className={`comment-list comment-list-flat ${commentLoading ? 'is-loading' : ''}`}>
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
            visibleTopLevelComments.map((comment) => {
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
            })
          ) : (
            <div className="comment-stateCard comment-emptyState">
              <div className="comment-stateTitle">Пока без комментариев</div>
              <div className="comment-stateText">Напишите первый комментарий — обсуждение появится прямо под публикацией.</div>
            </div>
          )}
          {remainingCommentThreads > 0 ? (
            <div className="comment-loadMoreRow">
              <button type="button" className="comment-loadMoreBtn" onClick={() => setVisibleCommentRoots((prev) => prev + 6)}>
                Показать ещё {remainingCommentThreads}
              </button>
            </div>
          ) : null}
        </div>
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
            <button className="comment-composer-btn comment-composerSend" type="button" aria-label={busy === 'comment' ? 'Отправляем комментарий' : 'Отправить комментарий'} onClick={addComment} disabled={busy === 'comment' || !buildCommentText(commentText)}>
              {busy === 'comment' ? '...' : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>}
            </button>
          </div>
          <div className={`comment-composerMeta ${commentComposerError ? 'is-error' : commentSlowState ? 'is-warning' : hasCommentDraft ? 'is-draft' : ''}`}>
            <span className="comment-composerState">{commentComposerStateLabel || 'Комментарий увидят все, у кого есть доступ к посту'}</span>
            {commentComposerError ? <button type="button" className="comment-composerMetaBtn" onClick={addComment}>Повторить</button> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

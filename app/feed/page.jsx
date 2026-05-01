'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PostAuthBottomNav from '../../components/PostAuthBottomNav';
import NotificationCenter from '@/components/NotificationCenter';
import { MinimalActionDialog, useMinimalActionDialog } from '@/components/MinimalActionDialog';
import { readPageCache, writePageCache } from '@/lib/page-cache';
import { sanitizeUrlForClient } from '@/lib/url-safety';
import PostRepostPreview from '@/components/PostRepostPreview';
import PostShareSheet from '@/components/PostShareSheet';
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
    text: 'Публикации появятся здесь, когда авторы начнут делиться контентом.',
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


function FeedPost({ post, onOpenComments, onOpenProfile, onOpenCommunity, onVote, onToggleLike, onToggleSave, onReport, onShare, onEdit, onDelete, actionBusyKey }) {
  const [expanded, setExpanded] = useState(false);
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
    <article className={`feed-post-card feed-page-card fsPost-card feedV2-card ${isRepost ? 'fsPost-card-repost' : ''} ${typeClassName}`} onClick={() => menuOpen && setMenuOpen(false)}>
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

      {postText ? (
        <div className="feed-post-text-wrap">
          <div className={`feed-post-text ${expanded ? '' : 'collapsed'}`}>{postText}</div>
          {postText.length > 140 ? (
            <button className="feed-post-more-btn" type="button" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Скрыть' : 'Ещё'}</button>
          ) : null}
        </div>
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
        <div className="feed-post-content-block fsPost-repostBlock is-active">
          <PostRepostPreview post={post.repost_of} />
        </div>
      ) : null}


      <div className="feed-post-footer feed-post-footerVk fsPost-footer">
        <div className="feed-post-actionRow fsPost-actionRow" aria-label="Действия с постом">
          <button
            className={`feed-post-actionBtn is-plus ${post.current_vote === 1 ? 'is-active' : ''}`}
            type="button"
            aria-label="Поставить плюс"
            disabled={actionBusyKey === `vote:${post.id}` || actionBusyKey === `like:${post.id}`}
            onClick={() => onVote(post.id, post.current_vote === 1 ? 0 : 1)}
          >
            <svg viewBox="0 0 24 24"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
            <span>{safeStat(post?.stats?.plus)}</span>
          </button>
          <button
            className={`feed-post-actionBtn is-minus ${post.current_vote === -1 ? 'is-active' : ''}`}
            type="button"
            aria-label="Поставить минус"
            disabled={actionBusyKey === `vote:${post.id}` || actionBusyKey === `like:${post.id}`}
            onClick={() => onVote(post.id, post.current_vote === -1 ? 0 : -1)}
          >
            <svg viewBox="0 0 24 24"><path d="M5 12h14"></path></svg>
            <span>{safeStat(post?.stats?.minus)}</span>
          </button>
          <button className="feed-post-actionBtn" type="button" aria-label="Открыть комментарии" onClick={() => onOpenComments(post.id)}>
            <svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.2A7.9 7.9 0 0 1 5 4.7 8.5 8.5 0 0 1 13 4a8 8 0 0 1 8 8z"></path></svg>
            <span>{safeStat(post?.stats?.comments)}</span>
          </button>
          <button className="feed-post-actionBtn" type="button" aria-label="Поделиться" onClick={() => onShare?.(post, 'sheet')}>
            <svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"></path><path d="M16 6l-4-4-4 4"></path><path d="M12 2v13"></path></svg>
            <span>{safeStat(post?.stats?.reposts)}</span>
          </button>
          <button className={`feed-post-actionBtn ${post.is_saved ? 'is-active' : ''}`} type="button" aria-label="Сохранить" disabled={actionBusyKey === `save:${post.id}`} onClick={() => onToggleSave?.(post.id)}>
            <svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"></path></svg>
            <span>{safeStat(post?.stats?.saves)}</span>
          </button>
        </div>
      </div>
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
      console.warn('feed load fallback enabled', loadError?.message || loadError);
      setError('');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

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
    const hasOverlayOpen = Boolean(settingsOpen || commentPostId || shareSheetPost);
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
  }, [commentPostId, settingsOpen, shareSheetPost]);

  useEffect(() => {
    const node = feedListRef.current;
    const hasBlockingSheet = Boolean(settingsOpen || commentPostId || shareSheetPost);
    if (!node || !hasBlockingSheet) return undefined;
    feedListScrollTopRef.current = node.scrollTop;
    const previousOverflowY = node.style.overflowY;
    const previousOverscrollBehavior = node.style.overscrollBehavior;
    const previousTouchAction = node.style.touchAction;
    const previousScrollSnapType = node.style.scrollSnapType;
    node.style.overflowY = 'hidden';
    node.style.overscrollBehavior = 'none';
    node.style.touchAction = 'none';
    node.style.scrollSnapType = 'none';
    node.dataset.feedOverlayLocked = 'true';
    return () => {
      node.style.overflowY = previousOverflowY;
      node.style.overscrollBehavior = previousOverscrollBehavior;
      node.style.touchAction = previousTouchAction;
      node.style.scrollSnapType = previousScrollSnapType;
      node.scrollTop = feedListScrollTopRef.current;
      delete node.dataset.feedOverlayLocked;
    };
  }, [commentPostId, settingsOpen, shareSheetPost]);

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
      if (settingsOpen) {
        closeFeedSettings();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeFeedSettings, closeShareSheet, commentPostId, settingsOpen, shareSheetPost]);

  useEffect(() => {
    if (!commentPostId) return;
    setCommentPostId(null);
    setCommentText('');
    setCommentReplyTarget(null);
    setCommentMenuId(null);
  }, [activeChip, contentMode, search]);

  useEffect(() => {
    if (!settingsOpen) return;
    if (commentPostId) setCommentPostId(null);
    if (shareSheetPost) closeShareSheet();
  }, [closeShareSheet, commentPostId, settingsOpen, shareSheetPost]);

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

    const sorted = filtered.slice().sort((left, right) => {
      if (getFeedOrderMode(feedSettings.sort_mode) === 'popular') {
        const diff = getPopularityScore(right) - getPopularityScore(left);
        if (diff !== 0) return diff;
      }
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });

    return sorted;
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
        text: 'Публикации появятся здесь, когда авторы начнут делиться контентом.',
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
      } catch (_error) {
        setError('Не удалось скопировать ссылку на публикацию.');
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
      await loadFeed();
    } catch (settingsError) {
      setError(settingsError.message || 'Не удалось сохранить настройки ленты.');
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

  return (
    <div className="app-shell">
      <div className={`app profile-app ${contentMode === 'videos' ? 'feedV2-appVideo' : ''}`}>
        <div className={`screen feed-screen feedV2-screen active ${contentMode === 'videos' ? 'feedV2-videoMode' : ''} ${settingsOpen ? 'is-settings-open' : ''} ${commentPostId ? 'is-comments-open' : ''} ${shareSheetPost ? 'is-share-open' : ''}`}>
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
              <NotificationCenter buttonClassName="icon-btn notifications-btn feedV2-notificationsBtn" />
            </div>
          </header>

          {error ? <div className="feedN-alert feedV2-alert">{error}</div> : null}

          {loading ? (
            <div className="feedN-empty feedV2-empty feedV2-emptyLoading">
              <div className="feedV2-emptyTitle">Загружаем ленту</div>
              <div className="feedV2-emptyText">Готовим посты для просмотра.</div>
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
              className={`feed-list feedV2-list ${contentMode === 'videos' ? 'feedV2-listVideo' : ''}`}
              aria-label={contentMode === 'videos' ? 'Видеолента' : 'Лента постов'}
              aria-hidden={settingsOpen || commentPostId || shareSheetPost ? 'true' : undefined}
            >
              {visiblePosts.map((post) => (
                <div className={`feedV2-item ${contentMode === 'videos' ? 'feedV2-itemVideo' : ''}`} key={post.id}>
                  <FeedPost
                    post={post}
                    onOpenComments={openComments}
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
                  />
                </div>
              ))}
            </section>
          )}
        </div>

        <PostAuthBottomNav current="feed" />
      </div>

      <PostShareSheet
        open={Boolean(shareSheetPost)}
        post={shareSheetPost}
        onClose={closeShareSheet}
        onRepostResult={(data, target) => {
          if (data?.original_post) patchPostSnapshot(data.original_post.id, data.original_post);
          if (data?.post && target?.targetType !== 'community') upsertPostSnapshot(data.post, { prepend: true });
        }}
        onChatShareResult={(data) => {
          if (data?.post && shareSheetPost) patchPostSnapshot(shareSheetPost.id, data.post);
        }}
        onSaveToggle={(postId) => handleToggleSave(postId)}
      />
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

      <div
        className={`global-comment-overlay feedV2-commentOverlay ${commentPost ? 'open' : ''}`}
        onClick={() => setCommentPostId(null)}
        onWheel={(event) => event.preventDefault()}
        onTouchMove={(event) => event.preventDefault()}
      ></div>
      <section
        ref={commentSheetRef}
        className={`global-comment-sheet feedV2-commentSheet ${commentPost ? 'open' : ''}`}
        role="dialog"
        aria-modal={commentPost ? 'true' : undefined}
        aria-labelledby="feed-comments-title"
        tabIndex={-1}
        style={commentPost ? {
          '--comment-sheet-keyboard-offset': `${commentSheetKeyboardInset}px`,
          transform: `translateX(-50%) translateY(${commentSheetDragOffset}px)`,
        } : undefined}
        onClick={(event) => { event.stopPropagation(); setCommentMenuId(null); }}
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
              <div className="comment-sheet-title" id="feed-comments-title">Комментарии</div>
              <div className="comment-sheet-meta">{currentComments.length} {currentComments.length === 1 ? 'комментарий' : currentComments.length >= 2 && currentComments.length <= 4 ? 'комментария' : 'комментариев'}</div>
            </div>
            <button className="ghost-btn comment-sheet-closeBtn" type="button" onClick={() => { setCommentPostId(null); setCommentReplyTarget(null); setCommentMenuId(null); setCommentComposerError(''); setCommentLoadError(''); }}>Закрыть</button>
          </div>
          <div className="comment-sheetControls">
            <div className="comment-sortRow" role="tablist" aria-label="Сортировка комментариев">
              <button type="button" className={`comment-sortBtn ${commentSortMode === 'activity' ? 'active' : ''}`} onClick={() => setCommentSortMode('activity')}>Обсуждение</button>
              <button type="button" className={`comment-sortBtn ${commentSortMode === 'latest' ? 'active' : ''}`} onClick={() => setCommentSortMode('latest')}>Новые</button>
              <button type="button" className={`comment-sortBtn ${commentSortMode === 'popular' ? 'active' : ''}`} onClick={() => setCommentSortMode('popular')}>Популярные</button>
              <button type="button" className={`comment-sortBtn ${commentSortMode === 'author' ? 'active' : ''}`} onClick={() => setCommentSortMode('author')}>Автор</button>
            </div>
            <div className="comment-sheetNavRow">
              <span className="comment-sheetNavMeta">Сортировка: {getCommentSortLabel(commentSortMode)}</span>
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
            <button className="comment-composer-btn comment-composerSend" type="button" onClick={addComment} disabled={busy === 'comment' || !buildCommentText(commentText)}>
              {busy === 'comment' ? '...' : 'Отправить'}
            </button>
          </div>
          <div className={`comment-composerMeta ${commentComposerError ? 'is-error' : commentSlowState ? 'is-warning' : hasCommentDraft ? 'is-draft' : ''}`}>
            <span className="comment-composerState">{commentComposerStateLabel || 'Комментарий увидят все, у кого есть доступ к посту'}</span>
            {commentComposerError ? <button type="button" className="comment-composerMetaBtn" onClick={addComment}>Повторить</button> : null}
          </div>
        </div>
      </section>
      <MinimalActionDialog {...actionDialog.dialogProps} />
    </div>
  );
}

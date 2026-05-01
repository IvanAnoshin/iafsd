'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PostAuthBottomNav from '@/components/PostAuthBottomNav';
import ProfileMediaAlbum from '@/components/ProfileMediaAlbum';
import ProfilePostCardRich from '@/components/profile/ProfilePostCardRich';
import { readPageCache, writePageCache } from '@/lib/page-cache';
import StoriesFoundationRail from '@/components/StoriesFoundationRail';
import { mapStoryToRailItem } from '@/lib/stories-foundation';

const PROFILE_CACHE_KEY = 'page:profile';
const PROFILE_CACHE_TTL = 3 * 60 * 1000;

const toneOptions = [
  { value: 'violet', label: 'Фиолетовый' },
  { value: 'mint', label: 'Мятный' },
  { value: 'blue', label: 'Синий' },
  { value: 'gold', label: 'Золотой' },
  { value: 'rose', label: 'Розовый' },
  { value: 'slate', label: 'Графит' },
];

function SettingsIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 3v3"></path><path d="M12 18v3"></path><path d="m4.93 4.93 2.12 2.12"></path><path d="m16.95 16.95 2.12 2.12"></path><path d="M3 12h3"></path><path d="M18 12h3"></path><path d="m4.93 19.07 2.12-2.12"></path><path d="m16.95 7.05 2.12-2.12"></path><circle cx="12" cy="12" r="4"></circle></svg>;
}

function EditIcon() {
  return <svg viewBox="0 0 24 24"><path d="m4 20 4.5-1 9.9-9.9a2.12 2.12 0 0 0-3-3L5.5 16 4 20z"></path><path d="m13.5 6.5 4 4"></path></svg>;
}

function createEditableState(profile) {
  return {
    handle: profile?.handle_raw || '',
    bio: profile?.bio || '',
    occupation: profile?.occupation || '',
    city: profile?.city || '',
    relationship_status: profile?.relationship_status || '',
    tone: profile?.tone || 'violet',
  };
}

function ProfileTabButton({ active, children, onClick }) {
  return (
    <button type="button" className={`profileClean-tab ${active ? 'is-active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const initialCacheRef = useRef(null);
  const [activeTab, setActiveTab] = useState('posts');
  const [profile, setProfile] = useState({
    first_name: 'Имя',
    last_name: 'Фамилия',
    id: null,
    handle_raw: '',
    bio: '',
    occupation: '',
    city: '',
    relationship_status: '',
    tone: 'violet',
    friendsCount: 0,
    followersCount: 0,
    subscriptionsCount: 0,
    dfsnConfigured: false,
  });
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [editor, setEditor] = useState(createEditableState(null));
  const [connectionsKind, setConnectionsKind] = useState('friends');
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [connections, setConnections] = useState({ title: 'Друзья', items: [], count: 0 });
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [profilePosts, setProfilePosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [publishingPost, setPublishingPost] = useState(false);
  const [actionBusyKey, setActionBusyKey] = useState('');
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaCounts, setMediaCounts] = useState({ all: 0, photos: 0, videos: 0, cards: 0 });
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaError, setMediaError] = useState('');
  const [mediaSaving, setMediaSaving] = useState(false);
  const [mediaSettings, setMediaSettings] = useState({ default_filter: 'all', grid_mode: 'comfortable', show_cards: true });

  useLayoutEffect(() => {
    const cachedState = readPageCache(PROFILE_CACHE_KEY, PROFILE_CACHE_TTL);
    initialCacheRef.current = cachedState;
    if (!cachedState) return;
    setActiveTab(cachedState.activeTab || 'posts');
    if (cachedState.profile) {
      setProfile((prev) => ({ ...prev, ...cachedState.profile }));
      setEditor(createEditableState(cachedState.profile));
      setProfileLoading(false);
    }
    setProfileMessage(cachedState.profileMessage || '');
    if (cachedState.connections) {
      setConnections(cachedState.connections);
      setConnectionsLoading(false);
    }
    setProfilePosts(Array.isArray(cachedState.profilePosts) ? cachedState.profilePosts : []);
    setPostsLoading(!cachedState.profilePosts);
    setMediaItems(Array.isArray(cachedState.mediaItems) ? cachedState.mediaItems : []);
    setMediaCounts(cachedState.mediaCounts || { all: 0, photos: 0, videos: 0, cards: 0 });
    setMediaLoading(!cachedState.mediaItems);
    setMediaSettings(cachedState.mediaSettings || { default_filter: 'all', grid_mode: 'comfortable', show_cards: true });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      try {
        if (!initialCacheRef.current?.profile) setProfileLoading(true);
        setProfileError('');

        const [sessionRes, profileRes] = await Promise.all([
          fetch('/api/auth/session', { cache: 'no-store' }),
          fetch('/api/profile', { cache: 'no-store' }),
        ]);

        if (sessionRes.status === 401 || profileRes.status === 401) {
          window.location.href = '/';
          return;
        }

        const sessionData = await sessionRes.json();
        const profileData = await profileRes.json();

        if (!sessionRes.ok) throw new Error(sessionData.error || 'Не удалось получить сессию.');
        if (!profileRes.ok) throw new Error(profileData.error || 'Не удалось получить профиль.');

        const userId = sessionData.user?.id || profileData.profile?.id || null;
        const userResponse = userId ? await fetch(`/api/users/${userId}`, { cache: 'no-store' }) : null;
        const userData = userResponse ? await userResponse.json() : null;

        const nextProfile = {
          ...profileData.profile,
          id: profileData.profile?.id || userId,
          first_name: profileData.profile?.first_name || sessionData.user?.first_name || 'Имя',
          last_name: profileData.profile?.last_name || sessionData.user?.last_name || 'Фамилия',
          friendsCount: userResponse?.ok ? userData.profile?.friendsCount || 0 : 0,
          followersCount: userResponse?.ok ? userData.profile?.followersCount || 0 : 0,
          subscriptionsCount: userResponse?.ok ? userData.profile?.subscriptionsCount || 0 : 0,
          dfsnConfigured: Boolean(sessionData.user?.dfsn?.configured),
          dfsnTrust: sessionData.user?.dfsn?.trust_label || null,
        };

        if (!cancelled) {
          setProfile((prev) => ({ ...prev, ...nextProfile }));
          setEditor(createEditableState(nextProfile));
          sessionStorage.setItem('fs_profile', JSON.stringify(nextProfile));
        }
      } catch (error) {
        if (!cancelled) setProfileError(error.message || 'Не удалось загрузить профиль.');
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    };

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadProfileMedia = async () => {
    try {
      if (!initialCacheRef.current?.mediaItems) setMediaLoading(true);
      setMediaError('');
      const response = await fetch('/api/profile/media', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить альбом.');
      setMediaItems(data.items || []);
      setMediaCounts(data.counts || { all: 0, photos: 0, videos: 0, cards: 0 });
      setMediaSettings(data.settings || { default_filter: 'all', grid_mode: 'comfortable', show_cards: true });
    } catch (error) {
      setMediaError(error.message || 'Не удалось загрузить альбом.');
    } finally {
      setMediaLoading(false);
    }
  };

  const saveMediaSettings = async (patch) => {
    const next = { ...mediaSettings, ...patch };
    setMediaSettings(next);
    try {
      setMediaSaving(true);
      const response = await fetch('/api/profile/media/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить настройки альбома.');
      setMediaSettings(data.settings || next);
    } catch (error) {
      setMediaError(error.message || 'Не удалось сохранить настройки альбома.');
    } finally {
      setMediaSaving(false);
    }
  };

  const loadProfilePosts = async () => {
    try {
      if (!initialCacheRef.current?.profilePosts) setPostsLoading(true);
      setPostsError('');
      const response = await fetch('/api/profile/posts', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить посты профиля.');
      setProfilePosts(data.posts || []);
    } catch (error) {
      setPostsError(error.message || 'Не удалось загрузить посты профиля.');
    } finally {
      setPostsLoading(false);
    }
  };

  useEffect(() => {
    loadProfilePosts();
    loadProfileMedia();
  }, []);

  useEffect(() => {
    if (!profile.id && !profilePosts.length && !mediaItems.length && profileLoading) return;
    writePageCache(PROFILE_CACHE_KEY, {
      activeTab,
      profile,
      profileMessage,
      profilePosts,
      mediaItems,
      mediaCounts,
      mediaSettings,
      connections,
    });
  }, [activeTab, profile, profileMessage, profilePosts, mediaItems, mediaCounts, mediaSettings, connections, profileLoading]);

  useEffect(() => {
    let cancelled = false;

    const loadConnections = async () => {
      if (!profile.id || !connectionsOpen) return;
      try {
        setConnectionsLoading(true);
        const response = await fetch(`/api/users/${profile.id}/connections?kind=${connectionsKind}`, { cache: 'no-store' });
        const data = await response.json();
        if (response.ok && !cancelled) setConnections(data);
      } catch {
      } finally {
        if (!cancelled) setConnectionsLoading(false);
      }
    };

    loadConnections();
    return () => {
      cancelled = true;
    };
  }, [profile.id, connectionsKind, connectionsOpen]);

  const firstName = profile.first_name || 'Имя';
  const lastName = profile.last_name || 'Фамилия';
  const fullName = `${firstName} ${lastName}`.trim();
  const firstLetter = firstName.charAt(0).toUpperCase() || 'F';
  const description = profile.bio || 'Здесь будет короткое описание человека, а не каша из кнопок и системных блоков.';
  const headline = [profile.occupation, profile.city].filter(Boolean).join(' · ');
  const [profileStoryItems, setProfileStoryItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const loadStories = async () => {
      if (!profile.id) {
        if (!cancelled) setProfileStoryItems([]);
        return;
      }
      try {
        const response = await fetch(`/api/stories?source=profile&user=${profile.id}&limit=6`, { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;
        const nextItems = Array.isArray(data.items)
          ? data.items.map((item) => mapStoryToRailItem(item, 'profile')).filter(Boolean)
          : [];
        if (!cancelled) setProfileStoryItems(nextItems);
      } catch {
      }
    };
    loadStories();
    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  const aboutItems = useMemo(() => [
    { label: 'Адрес профиля', value: profile.handle_raw ? `@${profile.handle_raw}` : 'Будет создан автоматически' },
    { label: 'Город', value: profile.city || 'Не указан' },
    { label: 'Занятие', value: profile.occupation || 'Не указано' },
    { label: 'Статус отношений', value: profile.relationship_status || 'Не указан' },
    { label: 'DFSN', value: profile.dfsnConfigured ? `Настроен${profile.dfsnTrust ? ` · ${profile.dfsnTrust}` : ''}` : 'Ещё не настроен' },
  ], [profile.city, profile.dfsnConfigured, profile.dfsnTrust, profile.handle_raw, profile.occupation, profile.relationship_status]);

  const openConnectionProfile = (id) => router.push(`/profile/${id}`);
  const openConnectionsPanel = (kind) => {
    if (connectionsOpen && connectionsKind === kind) {
      setConnectionsOpen(false);
      return;
    }
    setConnectionsKind(kind);
    setConnectionsOpen(true);
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setProfileError('');
    setProfileMessage('');

    try {
      setSavingProfile(true);
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editor),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить профиль.');

      const nextProfile = {
        ...profile,
        ...data.profile,
        friendsCount: profile.friendsCount,
        followersCount: profile.followersCount,
        subscriptionsCount: profile.subscriptionsCount,
        dfsnConfigured: profile.dfsnConfigured,
        dfsnTrust: profile.dfsnTrust,
      };
      setProfile(nextProfile);
      setEditor(createEditableState(nextProfile));
      setProfileMessage(data.message || 'Профиль обновлён.');
      setEditorOpen(false);
      sessionStorage.setItem('fs_profile', JSON.stringify(nextProfile));
    } catch (error) {
      setProfileError(error.message || 'Не удалось сохранить профиль.');
    } finally {
      setSavingProfile(false);
    }
  };

  const publishPost = async () => {
    const text = composerText.trim();
    if (!text) return;

    try {
      setPublishingPost(true);
      setPostsError('');
      setProfileMessage('');
      const response = await fetch('/api/profile/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, location: profile.city || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось опубликовать пост.');
      setProfilePosts((prev) => [data.post, ...prev]);
      setComposerText('');
      setComposerOpen(false);
      setProfileMessage(data.message || 'Пост опубликован в профиле.');
    } catch (error) {
      setPostsError(error.message || 'Не удалось опубликовать пост.');
    } finally {
      setPublishingPost(false);
    }
  };

  const replacePostSnapshot = (nextPost) => {
    setProfilePosts((prev) => prev.map((item) => (item.id === nextPost.id ? nextPost : item)));
  };

  const patchCommentsForPost = (postId, updater) => {
    setProfilePosts((prev) => prev.map((post) => {
      if (post.id !== postId) return post;
      const nextComments = typeof updater === 'function' ? updater(post.comments || []) : updater;
      return { ...post, comments: nextComments, stats: { ...post.stats, comments: nextComments.length } };
    }));
  };

  const handleVote = async (postId, value) => {
    try {
      setActionBusyKey(`vote:${postId}`);
      const response = await fetch(`/api/feed/posts/${postId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить голос.');
      replacePostSnapshot(data.post);
    } catch (error) {
      setPostsError(error.message || 'Не удалось обновить голос.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleToggleLike = async (post) => {
    try {
      setActionBusyKey(`like:${post.id}`);
      const response = await fetch(`/api/posts/${post.id}/like`, { method: post.is_liked ? 'DELETE' : 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить лайк.');
      replacePostSnapshot(data.post);
    } catch (error) {
      setPostsError(error.message || 'Не удалось обновить лайк.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleToggleSave = async (postId) => {
    try {
      setActionBusyKey(`save:${postId}`);
      const response = await fetch(`/api/feed/posts/${postId}/save`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить сохранение.');
      replacePostSnapshot(data.post);
    } catch (error) {
      setPostsError(error.message || 'Не удалось обновить сохранение.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleAddComment = async (postId, payload) => {
    try {
      setActionBusyKey(`comment:${postId}`);
      const response = await fetch(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: typeof payload === 'string' ? payload : payload?.text,
          reply_to_comment_id: typeof payload === 'object' ? payload?.replyToCommentId || null : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось добавить комментарий.');
      if (data.post) replacePostSnapshot(data.post);
      return true;
    } catch (error) {
      setPostsError(error.message || 'Не удалось добавить комментарий.');
      return false;
    } finally {
      setActionBusyKey('');
    }
  };

  const handleCommentVote = async (commentId, value) => {
    const targetPost = profilePosts.find((post) => (post.comments || []).some((comment) => comment.id === commentId));
    if (!targetPost) return;
    try {
      setActionBusyKey(`comment-vote:${commentId}`);
      const response = await fetch(`/api/comments/${commentId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить голос комментария.');
      if (data.comment) patchCommentsForPost(targetPost.id, (prev) => prev.map((item) => item.id === commentId ? data.comment : item));
    } catch (error) {
      setPostsError(error.message || 'Не удалось обновить голос комментария.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleCommentEdit = async (comment) => {
    const targetPost = profilePosts.find((post) => (post.comments || []).some((item) => item.id === comment.id));
    if (!targetPost || !comment?.is_mine || !comment?.moderation?.can_edit) return;
    const nextText = window.prompt('Изменить комментарий', comment.text || '');
    if (nextText == null) return;
    const text = nextText.trim();
    if (!text || text === comment.text) return;

    try {
      setActionBusyKey(`comment-edit:${comment.id}`);
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить комментарий.');
      if (data.comment) patchCommentsForPost(targetPost.id, (prev) => prev.map((item) => item.id === comment.id ? data.comment : item));
    } catch (error) {
      setPostsError(error.message || 'Не удалось обновить комментарий.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleCommentDelete = async (comment) => {
    const targetPost = profilePosts.find((post) => (post.comments || []).some((item) => item.id === comment.id));
    if (!targetPost || !comment?.is_mine || !comment?.moderation?.can_delete) return;
    if (!window.confirm('Удалить комментарий?')) return;

    try {
      setActionBusyKey(`comment-delete:${comment.id}`);
      const response = await fetch(`/api/comments/${comment.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось удалить комментарий.');
      if (data.comment) patchCommentsForPost(targetPost.id, (prev) => prev.map((item) => item.id === comment.id ? data.comment : item));
    } catch (error) {
      setPostsError(error.message || 'Не удалось удалить комментарий.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleCommentReport = async (comment) => {
    const targetPost = profilePosts.find((post) => (post.comments || []).some((item) => item.id === comment.id));
    if (!targetPost || !comment?.moderation?.can_report) return;
    const reason = window.prompt('Причина жалобы на комментарий: спам, оскорбление, обман или другое');
    if (reason == null) return;
    const normalized = reason.trim();
    if (!normalized) return;

    try {
      setActionBusyKey(`comment-report:${comment.id}`);
      const response = await fetch(`/api/reports/comments/${comment.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: normalized, details: normalized }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось отправить жалобу на комментарий.');
      if (data.comment) patchCommentsForPost(targetPost.id, (prev) => prev.map((item) => item.id === comment.id ? data.comment : item));
      setProfileMessage(data.message || 'Жалоба отправлена.');
    } catch (error) {
      setPostsError(error.message || 'Не удалось отправить жалобу на комментарий.');
    } finally {
      setActionBusyKey('');
    }
  };


  const handleDeletePost = async (postId) => {
    try {
      setActionBusyKey(`delete:${postId}`);
      const response = await fetch(`/api/profile/posts/${postId}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось удалить пост.');
      setProfilePosts((prev) => prev.filter((item) => item.id !== postId));
      setProfileMessage(data.message || 'Пост удалён.');
    } catch (error) {
      setPostsError(error.message || 'Не удалось удалить пост.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleReportPost = async (postId) => {
    const reason = window.prompt('Причина жалобы: спам, оскорбление, обман или другое');
    if (reason == null) return;
    const normalized = reason.trim();
    if (!normalized) return;

    try {
      setActionBusyKey(`report:${postId}`);
      const response = await fetch(`/api/reports/posts/${postId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: normalized, details: normalized }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось отправить жалобу.');
      setProfileMessage(data.message || 'Жалоба отправлена.');
    } catch (error) {
      setPostsError(error.message || 'Не удалось отправить жалобу.');
    } finally {
      setActionBusyKey('');
    }
  };


  const handleSharePost = async (post) => {
    const postId = Number(post?.id || 0);
    if (!postId || typeof window === 'undefined') return;
    const url = `${window.location.origin}/feed?post=${postId}`;
    const shareTitle = `${fullName || 'Публикация'} · Friendscape`;
    const shareText = String(post?.text || 'Публикация Friendscape').trim().slice(0, 140);

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url });
        setProfileMessage('Публикацией поделились.');
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setProfileMessage('Ссылка на публикацию скопирована.');
    } catch (_error) {
      setPostsError('Не удалось скопировать ссылку на публикацию.');
    }
  };

  const postSummary = useMemo(() => {
    if (!profilePosts.length) return 'Здесь будет личный контент пользователя. Лента при этом остаётся отдельным агрегатором.';
    return `В профиле ${profilePosts.length} ${profilePosts.length === 1 ? 'публикация' : profilePosts.length < 5 ? 'публикации' : 'публикаций'}.`;
  }, [profilePosts.length]);

  if (connectionsOpen) {
    return (
      <div className="app-shell">
        <div className="app profile-app">
          <main className="screen profileClean-screen">
            <section className="profileClean-card profileClean-panel">
              <div className="profileClean-sectionHead">
                <button type="button" className="profileClean-backBtn" onClick={() => setConnectionsOpen(false)}>← Назад</button>
                <h2 className="profileClean-sectionTitle">{connections.title || 'Связи'}</h2>
              </div>

              {connectionsLoading ? (
                <div className="profileClean-emptyState">Загрузка списка…</div>
              ) : connections.items?.length ? (
                <div className="profileClean-linksList">
                  {connections.items.map((item) => (
                    <button key={`${connectionsKind}-${item.id}`} type="button" className="profileClean-linkRow" onClick={() => openConnectionProfile(item.id)}>
                      <div className={`profileClean-miniAvatar is-${item.tone || 'violet'}`}>{item.initials}</div>
                      <div className="profileClean-linkText">{item.name}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="profileClean-emptyState">Пока список пуст.</div>
              )}
            </section>
          </main>
          <PostAuthBottomNav />
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="app profile-app">
        <main className="screen profileClean-screen">
          {profileError ? <div className="profileClean-alert is-error">{profileError}</div> : null}
          {profileMessage ? <div className="profileClean-alert is-success">{profileMessage}</div> : null}
          {postsError ? <div className="profileClean-alert is-error">{postsError}</div> : null}

          <header className="profileClean-topbar">
            <div>
              <div className="profileClean-topbarTitle">Профиль</div>
              <div className="profileClean-topbarText">Личное пространство без визуальной каши.</div>
            </div>
            <button type="button" className="profileClean-iconBtn" onClick={() => router.push('/settings')} aria-label="Настройки профиля">
              <SettingsIcon />
            </button>
          </header>

          <section className="profileClean-card profileClean-heroCard">
            <div className="profileClean-heroMain">
              <div className={`profileClean-avatar is-${profile.tone || 'violet'}`}>{firstLetter}</div>
              <div className="profileClean-identityBlock">
                <div className="profileClean-kicker">Мой профиль</div>
                <h1 className="profileClean-name">{fullName}</h1>
                <div className="profileClean-handle">{profile.handle_raw ? `@${profile.handle_raw}` : '@profile'}</div>
                <p className="profileClean-bio">{profileLoading ? 'Загружаем профиль…' : description}</p>
                <div className="profileClean-chipRow">
                  {headline ? <span className="profileClean-chip">{headline}</span> : null}
                  {profile.dfsnConfigured ? <span className="profileClean-chip">DFSN настроен</span> : null}
                </div>
              </div>
            </div>

            <div className="profileClean-statsGrid">
              <button type="button" className="profileClean-statItem is-accent"><strong>{profilePosts.length}</strong><span>постов</span></button>
              <button type="button" className="profileClean-statItem" onClick={() => openConnectionsPanel('friends')}><strong>{profile.friendsCount || 0}</strong><span>друзей</span></button>
              <button type="button" className="profileClean-statItem" onClick={() => openConnectionsPanel('followers')}><strong>{profile.followersCount || 0}</strong><span>подписчиков</span></button>
              <button type="button" className="profileClean-statItem" onClick={() => openConnectionsPanel('following')}><strong>{profile.subscriptionsCount || 0}</strong><span>подписок</span></button>
            </div>

            <div className="profileClean-actionBar">
              <button type="button" className="profileClean-primaryBtn" onClick={() => { setEditorOpen((prev) => !prev); setActiveTab('about'); }}>
                <EditIcon />
                <span>{editorOpen ? 'Скрыть редактирование' : 'Редактировать профиль'}</span>
              </button>
              <button type="button" className="profileClean-ghostBtn" onClick={() => router.push('/settings/dfsn')}>DFSN</button>
            </div>
          </section>

          <StoriesFoundationRail
            source="profile"
            title="Моменты"
            subtitle="Личные моменты и быстрый вход в просмотр."
            items={profileStoryItems}
            showCreateRing={false}
          />

          <nav className="profileClean-tabs" aria-label="Разделы профиля">
            <ProfileTabButton active={activeTab === 'posts'} onClick={() => setActiveTab('posts')}>Посты</ProfileTabButton>
            <ProfileTabButton active={activeTab === 'media'} onClick={() => setActiveTab('media')}>Фото и видео</ProfileTabButton>
            <ProfileTabButton active={activeTab === 'about'} onClick={() => setActiveTab('about')}>О себе</ProfileTabButton>
          </nav>

          {activeTab === 'posts' ? (
            <>
              <section className="profileClean-card profileClean-panel">
                <div className="profileClean-sectionHead">
                  <div>
                    <h2 className="profileClean-sectionTitle">Публикации</h2>
                    <p className="profileClean-sectionText">{postSummary}</p>
                  </div>
                  <button type="button" className="profileClean-primaryBtn is-small" onClick={() => setComposerOpen((prev) => !prev)}>
                    {composerOpen ? 'Скрыть' : 'Новая публикация'}
                  </button>
                </div>

                {composerOpen ? (
                  <div className="profileClean-composerBox">
                    <textarea
                      className="profileClean-textarea"
                      placeholder="Напишите коротко и по делу. Пост останется в профиле, а лента только агрегирует контент."
                      value={composerText}
                      onChange={(event) => setComposerText(event.target.value)}
                      rows={5}
                      maxLength={1200}
                    />
                    <div className="profileClean-composerActions">
                      <button type="button" className="profileClean-ghostBtn" onClick={() => { setComposerOpen(false); setComposerText(''); }}>Отмена</button>
                      <button type="button" className="profileClean-primaryBtn" disabled={publishingPost} onClick={publishPost}>{publishingPost ? 'Публикуем…' : 'Опубликовать'}</button>
                    </div>
                  </div>
                ) : null}
              </section>

              {postsLoading ? (
                <div className="profileClean-emptyState">Загружаем ваши посты…</div>
              ) : profilePosts.length ? (
                profilePosts.map((post) => (
                  <ProfilePostCardRich
                    key={post.id}
                    post={post}
                    authorName={fullName}
                    authorHandle={profile.handle_raw ? `@${profile.handle_raw}` : ''}
                    authorInitial={firstLetter}
                    showAuthor
                    allowDelete
                    allowSave
                    busyKey={actionBusyKey}
                    onVote={handleVote}
                    onToggleLike={handleToggleLike}
                    onToggleSave={handleToggleSave}
                    onAddComment={handleAddComment}
                    onCommentVote={handleCommentVote}
                    onCommentEdit={handleCommentEdit}
                    onCommentDelete={handleCommentDelete}
                    onCommentReport={handleCommentReport}
                    onDelete={handleDeletePost}
                    onShare={handleSharePost}
                  />
                ))
              ) : (
                <div className="profileClean-emptyState">Пока у вас нет публикаций. Первый пост появится именно здесь, а не в общей ленте.</div>
              )}
            </>
          ) : null}

          {activeTab === 'media' ? (
            <ProfileMediaAlbum
              title="Фото и видео"
              subtitle="Чистый альбом без лишних окон и перегруженных плиток."
              items={mediaItems}
              counts={mediaCounts}
              filter={mediaSettings.default_filter}
              onFilterChange={(value) => saveMediaSettings({ default_filter: value })}
              gridMode={mediaSettings.grid_mode}
              onGridModeChange={(value) => saveMediaSettings({ grid_mode: value })}
              showCards={mediaSettings.show_cards}
              onToggleShowCards={(value) => saveMediaSettings({ show_cards: value })}
              loading={mediaLoading}
              error={mediaError}
              saving={mediaSaving}
              persistLabel="Вид альбома сохраняется отдельно от ленты."
            />
          ) : null}

          {activeTab === 'about' ? (
            <>
              <section className="profileClean-card profileClean-panel">
                <div className="profileClean-sectionHead">
                  <div>
                    <h2 className="profileClean-sectionTitle">О себе</h2>
                    <p className="profileClean-sectionText">Только личная информация, без смешивания с публикациями и альбомом.</p>
                  </div>
                </div>

                <div className="profileClean-aboutGrid">
                  {aboutItems.map((item) => (
                    <div className="profileClean-aboutItem" key={item.label}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </section>

              {editorOpen ? (
                <section className="profileClean-card profileClean-panel">
                  <div className="profileClean-sectionHead">
                    <div>
                      <h2 className="profileClean-sectionTitle">Редактирование</h2>
                      <p className="profileClean-sectionText">Меняем только публичную часть профиля и не вмешиваемся в логику входа.</p>
                    </div>
                  </div>

                  <form className="profileClean-form" onSubmit={saveProfile}>
                    <label className="profileClean-field">
                      <span>Адрес профиля</span>
                      <input value={editor.handle} onChange={(event) => setEditor((prev) => ({ ...prev, handle: event.target.value.replace(/^@+/, '') }))} placeholder="ivan.anoshin" maxLength={24} />
                    </label>
                    <label className="profileClean-field">
                      <span>Описание</span>
                      <textarea value={editor.bio} onChange={(event) => setEditor((prev) => ({ ...prev, bio: event.target.value }))} placeholder="Коротко расскажи о себе" maxLength={240} rows={4} />
                    </label>
                    <div className="profileClean-formGrid">
                      <label className="profileClean-field">
                        <span>Город</span>
                        <input value={editor.city} onChange={(event) => setEditor((prev) => ({ ...prev, city: event.target.value }))} placeholder="Вильнюс" maxLength={80} />
                      </label>
                      <label className="profileClean-field">
                        <span>Занятие</span>
                        <input value={editor.occupation} onChange={(event) => setEditor((prev) => ({ ...prev, occupation: event.target.value }))} placeholder="Разработка продукта" maxLength={80} />
                      </label>
                    </div>
                    <label className="profileClean-field">
                      <span>Статус отношений</span>
                      <input value={editor.relationship_status} onChange={(event) => setEditor((prev) => ({ ...prev, relationship_status: event.target.value }))} placeholder="В активном поиске" maxLength={80} />
                    </label>
                    <label className="profileClean-field">
                      <span>Цвет профиля</span>
                      <select value={editor.tone} onChange={(event) => setEditor((prev) => ({ ...prev, tone: event.target.value }))}>
                        {toneOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </label>
                    <div className="profileClean-helpText">Имя и фамилия intentionally не трогаются, чтобы не задеть текущий вход и восстановление.</div>
                    <div className="profileClean-formActions">
                      <button type="button" className="profileClean-ghostBtn" onClick={() => { setEditor(createEditableState(profile)); setEditorOpen(false); }}>Отмена</button>
                      <button type="submit" className="profileClean-primaryBtn" disabled={savingProfile}>{savingProfile ? 'Сохраняем…' : 'Сохранить'}</button>
                    </div>
                  </form>
                </section>
              ) : null}
            </>
          ) : null}
        </main>

        <PostAuthBottomNav />
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import PostAuthBottomNav from '@/components/PostAuthBottomNav';
import { MinimalActionDialog, useMinimalActionDialog } from '@/components/MinimalActionDialog';
import ProfileMediaAlbum from '@/components/ProfileMediaAlbum';
import ProfilePostCardRich from '@/components/profile/ProfilePostCardRich';
import PostShareSheet from '@/components/PostShareSheet';
import { COMMUNITIES_UI_ENABLED } from '@/lib/product-flags';

function MessageIcon() {
  return <svg viewBox="0 0 24 24"><path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4A3.5 3.5 0 0 1 15.5 14H10l-4 4v-4.5A3.5 3.5 0 0 1 5 10.5z"></path></svg>;
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 5v14" /><path d="M5 12h14" /></svg>;
}

function CheckIcon() {
  return <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>;
}

function BackIcon() {
  return <svg viewBox="0 0 24 24"><path d="M15 6 9 12l6 6" /></svg>;
}

function profileAssetStyle(url) {
  const safe = String(url || '').trim().replace(/"/g, '%22');
  if (!safe) return undefined;
  return { backgroundImage: `linear-gradient(180deg, rgba(17,17,19,.05), rgba(17,17,19,.28)), url("${safe}")` };
}

function normalizeProfileLanguages(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const result = [];
  for (const item of source) {
    const text = String(item || '').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function ProfileTabButton({ active, children, onClick }) {
  return (
    <button type="button" className={`profileClean-tab ${active ? 'is-active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function ProfilePostsEmptyState({ restricted = false }) {
  if (restricted) return <div className="profileClean-emptyState">Публикации скрыты настройками приватности.</div>;
  return (
    <section className="profileClean-postsEmpty" aria-label="Пустой список публикаций">
      <div className="profileClean-postsEmptyArt" aria-hidden="true">
        <span className="profileClean-postsEmptyGlow" />
        <span className="profileClean-postsEmptyCard is-back" />
        <span className="profileClean-postsEmptyCard is-front"><span /><span /><span /></span>
        <span className="profileClean-postsEmptyPlus">•</span>
      </div>
      <div className="profileClean-postsEmptyBody">
        <span className="profileClean-postsEmptyBadge">Пока тихо</span>
        <strong className="profileClean-postsEmptyTitle">Публикаций ещё нет</strong>
        <p className="profileClean-postsEmptyText">Когда пользователь что-нибудь опубликует, записи появятся здесь.</p>
      </div>
    </section>
  );
}

function actionConfig(relation) {
  if (relation === 'friends') return { label: 'В друзьях', action: 'remove_friend', icon: <CheckIcon /> };
  if (relation === 'incoming_request') return { label: 'Принять заявку', action: 'accept_request', icon: <CheckIcon /> };
  if (relation === 'outgoing_request') return { label: 'Заявка отправлена', action: 'cancel_request', icon: <CheckIcon /> };
  return { label: 'Добавить в друзья', action: 'send_request', icon: <PlusIcon /> };
}


function ProfileCommunitiesCard({ items = [], hidden = false, loading = false, onOpen }) {
  return (
    <section className="profileClean-card profileClean-panel profileCommunities-card">
      <div className="profileClean-sectionHead">
        <div>
          <h2 className="profileClean-sectionTitle">Сообщества</h2>
          <p className="profileClean-sectionText">Места, где человек участвует в обсуждениях и публикует материалы.</p>
        </div>
      </div>
      {loading ? <div className="profileClean-emptyState">Загружаем сообщества…</div> : null}
      {!loading && hidden ? <div className="profileClean-emptyState">Список сообществ скрыт настройками приватности.</div> : null}
      {!loading && !hidden && !items.length ? <div className="profileClean-emptyState">Сообществ пока нет.</div> : null}
      {!loading && !hidden && items.length ? (
        <div className="profileCommunities-list">
          {items.slice(0, 8).map((item) => (
            <button key={item.id} type="button" onClick={() => onOpen?.(item.slug)}>
              <strong>{item.name}</strong>
              <span>{item.member_count} участников · {item.member_role ? roleLabelProfileCommunity(item.member_role) : 'участник'}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}


function communityInitials(name) {
  const parts = String(name || 'FS').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'F') + (parts[1]?.[0] || parts[0]?.[1] || 'S');
}

function ProfileCommunitiesListScreen({ items = [], hidden = false, loading = false, onBack, onOpen, title = 'Сообщества' }) {
  return (
    <div className="app-shell">
      <div className="app profile-app">
        <main className="screen profileClean-screen">
          <section className="profileClean-card profileClean-panel">
            <div className="profileClean-sectionHead">
              <button type="button" className="profileClean-backBtn" onClick={onBack}>← Назад</button>
              <h2 className="profileClean-sectionTitle">{title}</h2>
            </div>

            {loading ? <div className="profileClean-emptyState">Загрузка списка…</div> : null}
            {!loading && hidden ? <div className="profileClean-emptyState">Список сообществ скрыт настройками приватности.</div> : null}
            {!loading && !hidden && items.length ? (
              <div className="profileClean-linksList">
                {items.map((item) => (
                  <button key={item.id || item.slug} type="button" className="profileClean-linkRow" onClick={() => onOpen?.(item.slug)}>
                    <div className={`profileClean-miniAvatar is-${item.avatar_tone || 'violet'}`}>{communityInitials(item.name).toUpperCase()}</div>
                    <div className="profileClean-linkText">
                      <strong>{item.name}</strong>
                      <span>{item.member_count || 0} участников · {item.member_role ? roleLabelProfileCommunity(item.member_role) : 'участник'}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            {!loading && !hidden && !items.length ? <div className="profileClean-emptyState">Сообществ пока нет.</div> : null}
          </section>
        </main>
        <PostAuthBottomNav />
      </div>
    </div>
  );
}

function roleLabelProfileCommunity(role) {
  if (role === 'owner') return 'владелец';
  if (role === 'admin') return 'админ';
  if (role === 'moderator') return 'модератор';
  return 'участник';
}

export default function OtherProfilePage() {
  const actionDialog = useMinimalActionDialog();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = params?.id;

  const [activeTab, setActiveTab] = useState('posts');
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [connectionsKind, setConnectionsKind] = useState('friends');
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [communitiesOpen, setCommunitiesOpen] = useState(false);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsData, setConnectionsData] = useState({ title: 'Друзья', items: [], count: 0 });
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsRestricted, setPostsRestricted] = useState(false);
  const [postsBusyKey, setPostsBusyKey] = useState('');
  const [shareSheetPost, setShareSheetPost] = useState(null);
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaCounts, setMediaCounts] = useState({ all: 0, photos: 0, videos: 0, cards: 0 });
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaRestricted, setMediaRestricted] = useState(false);
  const [mediaFilter, setMediaFilter] = useState('all');
  const [mediaGridMode, setMediaGridMode] = useState('comfortable');
  const [profileCommunities, setProfileCommunities] = useState([]);
  const [communitiesLoading, setCommunitiesLoading] = useState(true);
  const [communitiesHidden, setCommunitiesHidden] = useState(false);

  const profileSource = String(searchParams?.get('from') || '').trim();
  const profileSourceUser = String(searchParams?.get('user') || '').trim();
  const profileSourceName = String(searchParams?.get('name') || '').trim();

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetch(`/api/users/${userId}`, { cache: 'no-store' });
      const data = await response.json();
      if (response.status === 401) {
        router.replace('/');
        return;
      }
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить профиль.');
      setProfile(data.profile);
    } catch (err) {
      console.warn('public profile load fallback enabled', err?.message || err);
      setError('');
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };


  const loadProfileCommunities = async () => {
    if (!COMMUNITIES_UI_ENABLED) {
      setProfileCommunities([]);
      setCommunitiesHidden(false);
      setCommunitiesLoading(false);
      return;
    }
    try {
      setCommunitiesLoading(true);
      const response = await fetch(`/api/users/${userId}/communities?limit=50`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { router.replace('/'); return; }
      if (response.ok) {
        setProfileCommunities(data.communities || []);
        setCommunitiesHidden(data.visible === false);
      } else {
        setProfileCommunities([]);
        setCommunitiesHidden(false);
      }
    } catch {
      setProfileCommunities([]);
    } finally {
      setCommunitiesLoading(false);
    }
  };

  const loadMedia = async () => {
    try {
      setMediaLoading(true);
      const response = await fetch(`/api/users/${userId}/media`, { cache: 'no-store' });
      const data = await response.json();
      if (response.status === 401) {
        router.replace('/');
        return;
      }
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить альбом пользователя.');
      setMediaRestricted(Boolean(data.restricted));
      setMediaItems(data.items || []);
      setMediaCounts(data.counts || { all: 0, photos: 0, videos: 0, cards: 0 });
    } catch (err) {
      console.warn('public profile media fallback enabled', err?.message || err);
      setMediaRestricted(false);
      setMediaItems([]);
      setMediaCounts({ all: 0, photos: 0, videos: 0, cards: 0 });
      setError('');
    } finally {
      setMediaLoading(false);
    }
  };

  const loadPosts = async () => {
    try {
      setPostsLoading(true);
      const response = await fetch(`/api/users/${userId}/posts`, { cache: 'no-store' });
      const data = await response.json();
      if (response.status === 401) {
        router.replace('/');
        return;
      }
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить посты пользователя.');
      setPostsRestricted(Boolean(data.restricted));
      setPosts(data.posts || []);
    } catch (err) {
      console.warn('public profile posts fallback enabled', err?.message || err);
      setPostsRestricted(false);
      setPosts([]);
      setError('');
    } finally {
      setPostsLoading(false);
    }
  };

  useEffect(() => {
    if (userId) {
      loadProfile();
      loadPosts();
      loadMedia();
      if (COMMUNITIES_UI_ENABLED) loadProfileCommunities();
    }
  }, [userId]);

  useEffect(() => {
    let cancelled = false;

    const loadConnections = async () => {
      if (!connectionsOpen || !profile?.id) return;
      try {
        setConnectionsLoading(true);
        const response = await fetch(`/api/users/${profile.id}/connections?kind=${connectionsKind}`, { cache: 'no-store' });
        const data = await response.json();
        if (response.status === 401) {
          router.replace('/');
          return;
        }
        if (!cancelled) {
          if (response.ok) {
            setConnectionsData({
              title: data.title || 'Связи',
              items: data.items || [],
              count: data.count || 0,
              restricted: Boolean(data.restricted),
            });
          } else {
            setConnectionsData({ title: 'Связи', items: [], count: 0, restricted: false });
          }
        }
      } catch {
        if (!cancelled) setConnectionsData({ title: 'Связи', items: [], count: 0, restricted: false });
      } finally {
        if (!cancelled) setConnectionsLoading(false);
      }
    };

    loadConnections();
    return () => { cancelled = true; };
  }, [connectionsOpen, connectionsKind, profile?.id, router]);

  const replacePostSnapshot = (nextPost) => {
    setPosts((prev) => prev.map((item) => (item.id === nextPost.id ? nextPost : item)));
  };

  const patchCommentsForPost = (postId, updater) => {
    setPosts((prev) => prev.map((post) => {
      if (post.id !== postId) return post;
      const nextComments = typeof updater === 'function' ? updater(post.comments || []) : updater;
      return { ...post, comments: nextComments, stats: { ...post.stats, comments: nextComments.length } };
    }));
  };

  const handleToggleLike = async (post) => {
    try {
      setPostsBusyKey(`like:${post.id}`);
      setError('');
      const response = await fetch(`/api/posts/${post.id}/like`, { method: post.is_liked ? 'DELETE' : 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить лайк.');
      replacePostSnapshot(data.post);
    } catch (err) {
      setError(err.message || 'Не удалось обновить лайк.');
    } finally {
      setPostsBusyKey('');
    }
  };


  const handleToggleSave = async (postId) => {
    try {
      setPostsBusyKey(`save:${postId}`);
      const response = await fetch(`/api/feed/posts/${postId}/save`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить сохранение.');
      if (data.post) replacePostSnapshot(data.post);
    } catch (err) {
      setError(err.message || 'Не удалось обновить сохранение.');
    } finally {
      setPostsBusyKey('');
    }
  };

  const handleAddComment = async (postId, payload) => {
    try {
      setPostsBusyKey(`comment:${postId}`);
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
    } catch (err) {
      setError(err.message || 'Не удалось добавить комментарий.');
      return false;
    } finally {
      setPostsBusyKey('');
    }
  };

  const handleCommentVote = async (commentId, value) => {
    const targetPost = posts.find((post) => (post.comments || []).some((comment) => comment.id === commentId));
    if (!targetPost) return;
    try {
      setPostsBusyKey(`comment-vote:${commentId}`);
      const response = await fetch(`/api/comments/${commentId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить голос комментария.');
      if (data.comment) patchCommentsForPost(targetPost.id, (prev) => prev.map((item) => item.id === commentId ? data.comment : item));
    } catch (err) {
      setError(err.message || 'Не удалось обновить голос комментария.');
    } finally {
      setPostsBusyKey('');
    }
  };

  const handleCommentEdit = async (comment) => {
    const targetPost = posts.find((post) => (post.comments || []).some((item) => item.id === comment.id));
    if (!targetPost || !comment?.is_mine || !comment?.moderation?.can_edit) return;
    const nextText = await actionDialog.askText({ title: 'Изменить комментарий', initialValue: comment.text || '', submitLabel: 'Сохранить' });
    if (nextText == null) return;
    const text = nextText.trim();
    if (!text || text === comment.text) return;

    try {
      setPostsBusyKey(`comment-edit:${comment.id}`);
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить комментарий.');
      if (data.comment) patchCommentsForPost(targetPost.id, (prev) => prev.map((item) => item.id === comment.id ? data.comment : item));
    } catch (err) {
      setError(err.message || 'Не удалось обновить комментарий.');
    } finally {
      setPostsBusyKey('');
    }
  };

  const handleCommentDelete = async (comment) => {
    const targetPost = posts.find((post) => (post.comments || []).some((item) => item.id === comment.id));
    if (!targetPost || !comment?.is_mine || !comment?.moderation?.can_delete) return;
    const confirmed = await actionDialog.confirmAction({ title: 'Удалить комментарий?', text: 'Комментарий исчезнет из обсуждения.', submitLabel: 'Удалить', danger: true });
    if (!confirmed) return;

    try {
      setPostsBusyKey(`comment-delete:${comment.id}`);
      const response = await fetch(`/api/comments/${comment.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось удалить комментарий.');
      if (data.comment) patchCommentsForPost(targetPost.id, (prev) => prev.map((item) => item.id === comment.id ? data.comment : item));
    } catch (err) {
      setError(err.message || 'Не удалось удалить комментарий.');
    } finally {
      setPostsBusyKey('');
    }
  };


  const handleCommentReport = async (comment) => {
    const targetPost = posts.find((post) => (post.comments || []).some((item) => item.id === comment.id));
    if (!targetPost || !comment?.moderation?.can_report) return;
    const reason = await actionDialog.askText({ title: 'Жалоба на комментарий', label: 'Причина', placeholder: 'Спам, оскорбление, обман или другое', submitLabel: 'Отправить' });
    if (reason == null) return;
    const normalized = reason.trim();
    if (!normalized) return;

    try {
      setPostsBusyKey(`comment-report:${comment.id}`);
      const response = await fetch(`/api/reports/comments/${comment.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: normalized, details: normalized }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось отправить жалобу на комментарий.');
      if (data.comment) patchCommentsForPost(targetPost.id, (prev) => prev.map((item) => item.id === comment.id ? data.comment : item));
      setMessage(data.message || 'Жалоба отправлена.');
    } catch (err) {
      setError(err.message || 'Не удалось отправить жалобу на комментарий.');
    } finally {
      setPostsBusyKey('');
    }
  };

  const runPeopleAction = async (action) => {
    try {
      setBusy(true);
      setError('');
      setMessage('');
      const data = await performSocialAction(userId, action);
      if (data.message) setMessage(data.message);
      await loadProfile();
      if (connectionsOpen) setConnectionsOpen(false);
      if (communitiesOpen) setCommunitiesOpen(false);
    } catch (err) {
      setError(err.message || 'Не удалось выполнить действие.');
    } finally {
      setBusy(false);
    }
  };

  const openCommunityFromPanel = (slug) => { if (COMMUNITIES_UI_ENABLED && slug) router.push(`/communities/${slug}`); };
  const openCommunitiesPanel = () => {
    if (!COMMUNITIES_UI_ENABLED) return;
    setConnectionsOpen(false);
    setCommunitiesOpen(true);
  };

  const openConnectionsPanel = (kind) => {
    if (connectionsOpen && connectionsKind === kind) {
      setConnectionsOpen(false);
      return;
    }
    setCommunitiesOpen(false);
    setConnectionsKind(kind);
    setConnectionsOpen(true);
  };

  const openProfileFromConnections = (id) => {
    if (!id) return;
    router.push(`/profile/${id}?from=profile`);
  };

  const openChatWithUser = (item = profile) => {
    if (!item) return;
    const query = new URLSearchParams({ user: String(item.id), name: item.name, from: 'profile' }).toString();
    router.push(`/chat?${query}`);
  };

  const handleBack = () => {
    if (profileSource === 'chat' && profileSourceUser) {
      const query = new URLSearchParams({ user: profileSourceUser, from: 'profile-back' });
      if (profileSourceName) query.set('name', profileSourceName);
      router.push(`/chat?${query.toString()}`);
      return;
    }
    if (profileSource === 'people') {
      router.push('/people');
      return;
    }
    if (profileSource === 'feed') {
      router.push('/feed');
      return;
    }
    router.back();
  };


  const handleReportPost = async (postId) => {
    const reason = await actionDialog.askText({ title: 'Жалоба на публикацию', label: 'Причина', placeholder: 'Спам, оскорбление, обман или другое', submitLabel: 'Отправить' });
    if (reason == null) return;
    const normalized = reason.trim();
    if (!normalized) return;

    try {
      setPostsBusyKey(`report:${postId}`);
      const response = await fetch(`/api/reports/posts/${postId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: normalized, details: normalized }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось отправить жалобу.');
      setMessage(data.message || 'Жалоба отправлена.');
    } catch (error) {
      setError(error.message || 'Не удалось отправить жалобу.');
    } finally {
      setPostsBusyKey('');
    }
  };


  const handleSharePost = (post) => {
    const postId = Number(post?.id || 0);
    if (!postId) return;
    setShareSheetPost(post);
    setError('');
  };


  if (loading) {
    return <div className="app-shell"><div className="app profile-app"><main className="screen profileClean-screen"><div className="profileClean-emptyState">Загрузка профиля…</div></main><PostAuthBottomNav /></div></div>;
  }

  if (!profile) {
    return <div className="app-shell"><div className="app profile-app"><main className="screen profileClean-screen"><div className="profileClean-emptyState">Профиль пока недоступен. Вернитесь назад или попробуйте позже.</div></main><PostAuthBottomNav /></div></div>;
  }

  if (COMMUNITIES_UI_ENABLED && communitiesOpen) {
    return (
      <ProfileCommunitiesListScreen
        items={profileCommunities}
        hidden={communitiesHidden}
        loading={communitiesLoading}
        onBack={() => setCommunitiesOpen(false)}
        onOpen={openCommunityFromPanel}
      />
    );
  }

  if (connectionsOpen) {
    return (
      <div className="app-shell">
        <div className="app profile-app">
          <main className="screen profileClean-screen">
            <section className="profileClean-card profileClean-panel">
              <div className="profileClean-sectionHead">
                <button type="button" className="profileClean-backBtn" onClick={() => setConnectionsOpen(false)}>← Назад</button>
                <h2 className="profileClean-sectionTitle">{connectionsData.title || 'Связи'}</h2>
              </div>
              {connectionsLoading ? (
                <div className="profileClean-emptyState">Загрузка списка…</div>
              ) : connectionsData.items?.length ? (
                <div className="profileClean-linksList">
                  {connectionsData.items.map((item) => (
                    <button key={item.id} type="button" className="profileClean-linkRow" onClick={() => openProfileFromConnections(item.id)}>
                      <div className={`profileClean-miniAvatar is-${item.tone || 'violet'}`}>{item.initials || 'FS'}</div>
                      <div className="profileClean-linkText">{item.name}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="profileClean-emptyState">{connectionsData.restricted ? 'Список скрыт настройками приватности.' : 'Здесь пока пусто.'}</div>
              )}
            </section>
          </main>
          <PostAuthBottomNav />
        </div>
      </div>
    );
  }

  const secondaryLabel = profile.isFollowing ? 'Вы подписаны' : 'Подписаться';
  const profileRestricted = Boolean(profile.privacy?.profile_restricted);
  const activityHidden = Boolean(profile.privacy?.activity_hidden);
  const headline = profileRestricted ? '' : [profile.occupation, profile.city].filter(Boolean).join(' · ');
  const heroBio = profileRestricted ? 'Подробности профиля скрыты настройками приватности.' : (profile.bio || `${profile.occupation || 'Участник'} · ${profile.city || 'Friendscape'}`);


  return (
    <div className="app-shell">
      <div className="app profile-app">
        <main className="screen profileClean-screen">
          {error ? <div className="profileClean-alert is-error">{error}</div> : null}

          <button type="button" className="profileClean-backBtn profileV2-floatingBack" onClick={handleBack}>
            <BackIcon />
            <span>Назад</span>
          </button>

          <section className="profileClean-card profileV2-heroCard">
            <div className={`profileV2-cover is-${profile.cover_tone || profile.tone || 'violet'}`} style={profileAssetStyle(profile.cover_url)} aria-hidden="true" />
            <div className="profileV2-heroTop">
              <div className={`profileClean-avatar profileV2-avatar is-${profile.tone || 'violet'}`}>{profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : profile.initials || profile.name?.charAt(0) || 'F'}</div>
              <button type="button" className="profileClean-iconBtn profileV2-menuBtn" aria-label="Меню профиля">•••</button>
            </div>

            <div className="profileV2-identity">
              <h1 className="profileClean-name profileV2-name">{profile.name}</h1>
              <div className="profileClean-handle profileV2-handle">{profile.handle || '@friendscape'}</div>
              <p className="profileClean-bio profileV2-bio">{heroBio}</p>
              <div className="profileClean-chipRow profileV2-tags">
                <span className="profileClean-chip">{activityHidden ? 'Активность скрыта' : profile.status === 'online' ? 'Онлайн' : 'Недавно был(а) в сети'}</span>
                {headline ? <span className="profileClean-chip">{headline}</span> : null}
                {profile.interests?.slice?.(0, 2).map((interest) => <span className="profileClean-chip" key={interest}>{interest}</span>)}
                {profile.followsYou ? <span className="profileClean-chip">Подписан(а) на вас</span> : null}
              </div>
            </div>

            <div className="profileV2-stats" aria-label="Статистика профиля">
              <button type="button" className="profileV2-stat" disabled={activityHidden} onClick={() => openConnectionsPanel('friends')}><strong>{activityHidden ? '—' : profile.friendsCount || 0}</strong><span>Друзья</span></button>
              <button type="button" className="profileV2-stat" disabled={activityHidden} onClick={() => openConnectionsPanel('followers')}><strong>{activityHidden ? '—' : profile.followersCount || 0}</strong><span>Подписчики</span></button>
              <button type="button" className="profileV2-stat" disabled={activityHidden} onClick={() => openConnectionsPanel('following')}><strong>{activityHidden ? '—' : profile.subscriptionsCount || 0}</strong><span>Подписки</span></button>
            </div>

            <div className="profileV2-actions">
              <button type="button" className="profileClean-primaryBtn" disabled={busy} onClick={() => runPeopleAction(friendAction.action)}>{friendAction.icon}<span>{busy ? '…' : friendAction.label}</span></button>
              {profile.relation === 'incoming_request' ? (
                <button type="button" className="profileClean-ghostBtn" disabled={busy} onClick={() => runPeopleAction('reject_request')}>Отклонить</button>
              ) : (
                <button type="button" className={`profileClean-ghostBtn ${profile.isFollowing ? 'is-active' : ''}`} disabled={busy} onClick={() => runPeopleAction(profile.isFollowing ? 'unfollow' : 'follow')}>{secondaryLabel}</button>
              )}
              <button type="button" className="profileClean-ghostBtn profileV2-messageBtn" onClick={() => openChatWithUser()}><MessageIcon /><span>Написать</span></button>
            </div>
          </section>

          <nav className="profileClean-tabs profileV2-tabs" aria-label="Разделы профиля">
            <ProfileTabButton active={activeTab === 'posts'} onClick={() => setActiveTab('posts')}>Посты</ProfileTabButton>
            <ProfileTabButton active={activeTab === 'media'} onClick={() => setActiveTab('media')}>Медиа</ProfileTabButton>
            <ProfileTabButton active={activeTab === 'about'} onClick={() => setActiveTab('about')}>О человеке</ProfileTabButton>
          </nav>

          {activeTab === 'posts' ? (
            <>
              {postsLoading ? (
                <div className="profileClean-emptyState">Загрузка постов…</div>
              ) : posts.length ? (
                posts.map((post) => (
                  <ProfilePostCardRich
                    key={post.id}
                    post={post}
                    authorName={profile.name}
                    authorHandle={profile.handle}
                    authorInitial={profile.initials || profile.name?.charAt(0) || 'F'}
                    showAuthor
                    allowSave
                    busyKey={postsBusyKey}
                    onToggleLike={handleToggleLike}
                    onToggleSave={handleToggleSave}
                    onAddComment={handleAddComment}
                    onCommentVote={handleCommentVote}
                    onCommentEdit={handleCommentEdit}
                    onCommentDelete={handleCommentDelete}
                    onCommentReport={handleCommentReport}
                    onReport={handleReportPost}
                    onShare={handleSharePost}
                    onOpenAuthor={handleOpenAuthor}
                  />
                ))
              ) : (
                <ProfilePostsEmptyState restricted={postsRestricted} />
              )}
            </>
          ) : null}

          {activeTab === 'media' ? (
            mediaRestricted ? (
              <section className="profileClean-card profileClean-panel">
                <div className="profileClean-emptyState">Медиа скрыты настройками приватности.</div>
              </section>
            ) : (
              <ProfileMediaAlbum
                title="Фото и видео"
                subtitle="Альбом пользователя с учётом прав просмотра публикаций."
                items={mediaItems}
                counts={mediaCounts}
                filter={mediaFilter}
                onFilterChange={setMediaFilter}
                gridMode={mediaGridMode}
                onGridModeChange={setMediaGridMode}
                loading={mediaLoading}
              />
            )
          ) : null}




          {activeTab === 'about' ? (
            <section className="profileClean-card profileClean-panel">
              {profile.interests?.length ? (
                <div className="profileEdit-aboutInterests">
                  {profile.interests.map((interest) => <span key={interest}>{interest}</span>)}
                </div>
              ) : null}

              {aboutItems.length ? (
                <div className="profileClean-aboutList">
                  {aboutItems.map((item) => (
                    <div className="profileClean-aboutItem" key={item.label}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="profileClean-emptyState">Пользователь пока не заполнил информацию о себе.</div>
              )}
            </section>
          ) : null}
        </main>
        <PostShareSheet
          open={Boolean(shareSheetPost)}
          post={shareSheetPost}
          onClose={() => setShareSheetPost(null)}
          onRepostResult={(data) => {
            if (data?.original_post) replacePostSnapshot(data.original_post);
          }}
          onChatShareResult={(data) => {
            if (data?.post) replacePostSnapshot(data.post);
          }}
          onSaveToggle={(postId) => handleToggleSave(postId)}
        />

        <MinimalActionDialog {...actionDialog.dialogProps} />
        <PostAuthBottomNav />
      </div>
    </div>
  );
}

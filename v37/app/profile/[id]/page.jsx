'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import PostAuthBottomNav from '@/components/PostAuthBottomNav';
import ProfileMediaAlbum from '@/components/ProfileMediaAlbum';
import ProfilePostCardRich from '@/components/profile/ProfilePostCardRich';

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

function ProfileTabButton({ active, children, onClick }) {
  return (
    <button type="button" className={`profileClean-tab ${active ? 'is-active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function actionConfig(relation) {
  if (relation === 'friends') return { label: 'В друзьях', action: 'remove_friend', icon: <CheckIcon /> };
  if (relation === 'incoming_request') return { label: 'Принять заявку', action: 'accept_request', icon: <CheckIcon /> };
  if (relation === 'outgoing_request') return { label: 'Заявка отправлена', action: 'cancel_request', icon: <CheckIcon /> };
  return { label: 'Добавить в друзья', action: 'send_request', icon: <PlusIcon /> };
}

export default function OtherProfilePage() {
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
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsData, setConnectionsData] = useState({ title: 'Друзья', items: [], count: 0 });
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsBusyKey, setPostsBusyKey] = useState('');
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaCounts, setMediaCounts] = useState({ all: 0, photos: 0, videos: 0, cards: 0 });
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaFilter, setMediaFilter] = useState('all');
  const [mediaGridMode, setMediaGridMode] = useState('comfortable');

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
      setError(err.message || 'Не удалось загрузить профиль.');
    } finally {
      setLoading(false);
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
      setMediaItems(data.items || []);
      setMediaCounts(data.counts || { all: 0, photos: 0, videos: 0, cards: 0 });
    } catch (err) {
      setError(err.message || 'Не удалось загрузить альбом пользователя.');
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
      setPosts(data.posts || []);
    } catch (err) {
      setError(err.message || 'Не удалось загрузить посты пользователя.');
    } finally {
      setPostsLoading(false);
    }
  };

  useEffect(() => {
    if (userId) {
      loadProfile();
      loadPosts();
      loadMedia();
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
            });
          } else {
            setConnectionsData({ title: 'Связи', items: [], count: 0 });
          }
        }
      } catch {
        if (!cancelled) setConnectionsData({ title: 'Связи', items: [], count: 0 });
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
    const nextText = window.prompt('Изменить комментарий', comment.text || '');
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
    if (!window.confirm('Удалить комментарий?')) return;

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
    const reason = window.prompt('Причина жалобы на комментарий: спам, оскорбление, обман или другое');
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
    } catch (err) {
      setError(err.message || 'Не удалось выполнить действие.');
    } finally {
      setBusy(false);
    }
  };

  const openConnectionsPanel = (kind) => {
    if (connectionsOpen && connectionsKind === kind) {
      setConnectionsOpen(false);
      return;
    }
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
    const reason = window.prompt('Причина жалобы: спам, оскорбление, обман или другое');
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


  const handleSharePost = async (post) => {
    const postId = Number(post?.id || 0);
    if (!postId || typeof window === 'undefined') return;
    const url = `${window.location.origin}/feed?post=${postId}`;
    const shareTitle = `${profile?.name || 'Публикация'} · Friendscape`;
    const shareText = String(post?.text || 'Публикация Friendscape').trim().slice(0, 140);

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url });
        setMessage('Публикацией поделились.');
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setMessage('Ссылка на публикацию скопирована.');
    } catch (_error) {
      setError('Не удалось скопировать ссылку на публикацию.');
    }
  };

  const handleOpenAuthor = (author) => {
    const authorId = Number(author?.id || 0);
    if (!authorId) return;
    if (Number(profile?.id || 0) === authorId) return;
    router.push(`/profile/${authorId}?from=profile&user=${profile?.id || ''}`);
  };
  const postSummary = useMemo(() => {
    if (!posts.length) return 'У пользователя пока нет публикаций в профиле.';
    return `В профиле ${posts.length} ${posts.length === 1 ? 'публикация' : posts.length < 5 ? 'публикации' : 'публикаций'}.`;
  }, [posts.length]);

  const friendAction = useMemo(() => actionConfig(profile?.relation), [profile?.relation]);
  const aboutItems = useMemo(() => profile ? [
    { label: 'Описание', value: profile.bio || 'Пользователь ещё не заполнил описание.' },
    { label: 'Город', value: profile.city || 'Не указан' },
    { label: 'Занятие', value: profile.occupation || 'Не указано' },
    { label: 'Статус отношений', value: profile.relationship_status || 'Не указан' },
    { label: 'Общие связи', value: profile.mutual || 'Пока без общих связей' },
    { label: 'Подписка', value: profile.isFollowing ? 'Вы подписаны' : profile.followsYou ? 'Подписан(а) на вас' : 'Пока без взаимной подписки' },
  ] : [], [profile]);

  if (loading) {
    return <div className="app-shell"><div className="app profile-app"><main className="screen profileClean-screen"><div className="profileClean-emptyState">Загрузка профиля…</div></main><PostAuthBottomNav /></div></div>;
  }

  if (!profile) {
    return <div className="app-shell"><div className="app profile-app"><main className="screen profileClean-screen"><div className="profileClean-emptyState">Профиль не найден.</div></main><PostAuthBottomNav /></div></div>;
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
                <div className="profileClean-emptyState">Здесь пока пусто.</div>
              )}
            </section>
          </main>
          <PostAuthBottomNav />
        </div>
      </div>
    );
  }

  const secondaryLabel = profile.isFollowing ? 'Вы подписаны' : 'Подписаться';
  const headline = [profile.occupation, profile.city].filter(Boolean).join(' · ');

  return (
    <div className="app-shell">
      <div className="app profile-app">
        <main className="screen profileClean-screen">
          {error ? <div className="profileClean-alert is-error">{error}</div> : null}
          {message ? <div className="profileClean-alert is-success">{message}</div> : null}

          <header className="profileClean-topbar">
            <button type="button" className="profileClean-backBtn" onClick={handleBack}>
              <BackIcon />
              <span>Назад</span>
            </button>
            <div>
              <div className="profileClean-topbarTitle">Профиль</div>
              <div className="profileClean-topbarText">Чистая карточка человека без лишнего шума.</div>
            </div>
          </header>

          <section className="profileClean-card profileClean-heroCard">
            <div className="profileClean-heroMain">
              <div className={`profileClean-avatar is-${profile.tone || 'violet'}`}>{profile.initials || profile.name?.charAt(0) || 'F'}</div>
              <div className="profileClean-identityBlock">
                <div className="profileClean-kicker">Профиль пользователя</div>
                <h1 className="profileClean-name">{profile.name}</h1>
                <div className="profileClean-handle">{profile.handle || '@friendscape'}</div>
                <p className="profileClean-bio">{profile.bio || `${profile.occupation || 'Участник'} · ${profile.city || 'Friendscape'}`}</p>
                <div className="profileClean-chipRow">
                  <span className="profileClean-chip">{profile.status === 'online' ? 'Онлайн' : 'Недавно был(а) в сети'}</span>
                  {headline ? <span className="profileClean-chip">{headline}</span> : null}
                  {profile.followsYou ? <span className="profileClean-chip">Подписан(а) на вас</span> : null}
                </div>
              </div>
            </div>

            <div className="profileClean-statsGrid">
              <button type="button" className="profileClean-statItem is-accent"><strong>{posts.length}</strong><span>постов</span></button>
              <button type="button" className="profileClean-statItem" onClick={() => openConnectionsPanel('friends')}><strong>{profile.friendsCount || 0}</strong><span>друзей</span></button>
              <button type="button" className="profileClean-statItem" onClick={() => openConnectionsPanel('followers')}><strong>{profile.followersCount || 0}</strong><span>подписчиков</span></button>
              <button type="button" className="profileClean-statItem" onClick={() => openConnectionsPanel('following')}><strong>{profile.subscriptionsCount || 0}</strong><span>подписок</span></button>
            </div>

            <div className="profileClean-actionBar is-stacked">
              <button type="button" className="profileClean-primaryBtn" disabled={busy} onClick={() => runPeopleAction(friendAction.action)}>{friendAction.icon}<span>{busy ? '…' : friendAction.label}</span></button>
              <div className="profileClean-inlineControls is-grow">
                {profile.relation === 'incoming_request' ? (
                  <button type="button" className="profileClean-ghostBtn" disabled={busy} onClick={() => runPeopleAction('reject_request')}>Отклонить</button>
                ) : (
                  <button type="button" className={`profileClean-ghostBtn ${profile.isFollowing ? 'is-active' : ''}`} disabled={busy} onClick={() => runPeopleAction(profile.isFollowing ? 'unfollow' : 'follow')}>{secondaryLabel}</button>
                )}
                <button type="button" className="profileClean-iconBtn" onClick={() => openChatWithUser()} aria-label="Написать"><MessageIcon /></button>
              </div>
            </div>
          </section>

          <nav className="profileClean-tabs" aria-label="Разделы профиля">
            <ProfileTabButton active={activeTab === 'posts'} onClick={() => setActiveTab('posts')}>Посты</ProfileTabButton>
            <ProfileTabButton active={activeTab === 'media'} onClick={() => setActiveTab('media')}>Фото и видео</ProfileTabButton>
            <ProfileTabButton active={activeTab === 'about'} onClick={() => setActiveTab('about')}>О человеке</ProfileTabButton>
          </nav>

          {activeTab === 'posts' ? (
            <>
              <section className="profileClean-card profileClean-panel">
                <div className="profileClean-sectionHead">
                  <div>
                    <h2 className="profileClean-sectionTitle">Публикации</h2>
                    <p className="profileClean-sectionText">{postSummary} Общая лента при этом остаётся агрегатором.</p>
                  </div>
                </div>
              </section>

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
                <div className="profileClean-emptyState">У этого пользователя пока нет публикаций в профиле.</div>
              )}
            </>
          ) : null}

          {activeTab === 'media' ? (
            <ProfileMediaAlbum
              title="Фото и видео"
              subtitle="Отдельный альбом пользователя без визуального мусора и тяжёлых плиток."
              items={mediaItems}
              counts={mediaCounts}
              filter={mediaFilter}
              onFilterChange={setMediaFilter}
              gridMode={mediaGridMode}
              onGridModeChange={setMediaGridMode}
              loading={mediaLoading}
            />
          ) : null}

          {activeTab === 'about' ? (
            <section className="profileClean-card profileClean-panel">
              <div className="profileClean-sectionHead">
                <div>
                  <h2 className="profileClean-sectionTitle">О человеке</h2>
                  <p className="profileClean-sectionText">Спокойный информационный блок отдельно от публикаций и медиа.</p>
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
          ) : null}
        </main>
        <PostAuthBottomNav />
      </div>
    </div>
  );
}

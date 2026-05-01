'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COMMUNITIES_UI_ENABLED } from '@/lib/product-flags';

function formatName(author) {
  if (!author) return 'Публикация Friendscape';
  return `${author.first_name || ''} ${author.last_name || ''}`.trim() || author.name || 'Пользователь';
}

function getPostText(post) {
  const text = String(post?.text || '').trim();
  if (text && text !== 'Медиа') return text;
  const originalText = String(post?.repost_of?.text || '').trim();
  if (originalText && originalText !== 'Медиа') return originalText;
  const media = Array.isArray(post?.media) ? post.media : [];
  return media.length ? 'Публикация с медиа' : 'Публикация Friendscape';
}

function getPostUrl(post) {
  if (typeof window === 'undefined') return '';
  const id = Number(post?.repost_of?.id || post?.id || 0);
  return `${window.location.origin}/feed${id ? `?post=${id}` : ''}`;
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

export default function PostShareSheet({
  post,
  open,
  onClose,
  onRepostResult,
  onChatShareResult,
  onSaveToggle,
}) {
  const [destination, setDestination] = useState('profile');
  const [comment, setComment] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [communities, setCommunities] = useState([]);
  const [communitiesLoading, setCommunitiesLoading] = useState(false);
  const [selectedCommunityId, setSelectedCommunityId] = useState('');
  const [chatQuery, setChatQuery] = useState('');
  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [inlineNote, setInlineNote] = useState('');
  const sheetRef = useRef(null);

  const visible = Boolean(open && post);
  const previewText = useMemo(() => getPostText(post).slice(0, 180), [post]);
  const previewAuthor = useMemo(() => formatName(post?.author || post?.repost_of?.author), [post]);

  const resetLocal = useCallback(() => {
    setDestination('profile');
    setComment('');
    setVisibility('public');
    setSelectedCommunityId('');
    setChatQuery('');
    setSelectedChatIds([]);
    setError('');
    setInlineNote('');
    setSending(false);
  }, []);

  const close = useCallback(() => {
    resetLocal();
    onClose?.();
  }, [onClose, resetLocal]);

  useEffect(() => {
    if (!visible) return;
    setError('');
    setInlineNote('');
    window.requestAnimationFrame(() => sheetRef.current?.focus({ preventScroll: true }));
  }, [visible, post?.id]);

  useEffect(() => {
    if (!visible) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, visible]);

  useEffect(() => {
    if (!COMMUNITIES_UI_ENABLED || !visible || destination !== 'community') return;
    let cancelled = false;
    const controller = new AbortController();
    setCommunitiesLoading(true);
    setError('');
    fetch('/api/posts/repost-targets', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.json().then((data) => ({ response, data })).catch(() => ({ response, data: {} })))
      .then(({ response, data }) => {
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить сообщества.');
        const items = Array.isArray(data.communities) ? data.communities : [];
        setCommunities(items);
        setSelectedCommunityId((prev) => prev || (items[0]?.id ? String(items[0].id) : ''));
      })
      .catch((loadError) => {
        if (cancelled || loadError?.name === 'AbortError') return;
        setCommunities([]);
        setSelectedCommunityId('');
        setError(loadError.message || 'Не удалось загрузить сообщества.');
      })
      .finally(() => {
        if (!cancelled) setCommunitiesLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [destination, visible]);

  useEffect(() => {
    if (!visible || destination !== 'chat') return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setChatsLoading(true);
        setError('');
        const params = new URLSearchParams({ limit: '20', scope: 'active' });
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
  }, [chatQuery, destination, visible]);

  const toggleChat = useCallback((chatId) => {
    const id = String(chatId || '').trim();
    if (!id) return;
    setSelectedChatIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  const copyLink = useCallback(async () => {
    if (!post) return;
    try {
      await navigator.clipboard.writeText(getPostUrl(post));
      setInlineNote('Ссылка скопирована');
      setTimeout(() => setInlineNote(''), 1200);
    } catch {
      setError('Не удалось скопировать ссылку.');
    }
  }, [post]);

  const publishRepost = useCallback(async () => {
    if (!post) return;
    const targetType = destination === 'community' ? 'community' : 'profile';
    const targetId = targetType === 'community' ? String(selectedCommunityId || '').trim() : null;
    if (targetType === 'community' && !targetId) {
      setError('Выберите сообщество для репоста.');
      return;
    }

    try {
      setSending(true);
      setError('');
      const headers = { 'Content-Type': 'application/json', ...(await getCsrfHeaders()) };
      const response = await fetch(`/api/posts/${post.id}/repost`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          targetType,
          targetId,
          comment,
          visibility,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось сделать репост.');
      onRepostResult?.(data, { targetType, targetId });
      if (data?.already_exists) {
        setInlineNote(targetType === 'community' ? 'Этот репост уже есть в выбранном сообществе.' : 'Этот репост уже есть в вашем профиле.');
        return;
      }
      close();
    } catch (submitError) {
      setError(submitError.message || 'Не удалось сделать репост.');
    } finally {
      setSending(false);
    }
  }, [close, comment, destination, onRepostResult, post, selectedCommunityId, visibility]);

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
      close();
    } catch (sendError) {
      setError(sendError.message || 'Не удалось отправить публикацию.');
    } finally {
      setSending(false);
    }
  }, [close, comment, onChatShareResult, post, selectedChatIds]);

  const destinationLabel = destination === 'chat'
    ? 'Отправка в чат'
    : destination === 'link'
      ? 'Ссылка без репоста'
      : destination === 'community'
        ? 'Репост в сообщество'
        : 'Репост в профиль';

  return (
    <>
      <div
        className={`feed-share-backdrop ${visible ? 'open' : ''}`}
        aria-hidden="true"
        onClick={close}
        onWheel={(event) => event.preventDefault()}
        onTouchMove={(event) => event.preventDefault()}
      ></div>
      <aside
        ref={sheetRef}
        className={`feed-share-sheet ${visible ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedShareTitle"
        aria-describedby="feedShareSubtitle"
        tabIndex={-1}
      >
        <div className="feed-share-handle"></div>
        <div className="feed-share-head">
          <div className="feed-share-titleBlock">
            <div className="feed-share-kicker">{destinationLabel}</div>
            <div className="feed-share-title" id="feedShareTitle">Куда отправить?</div>
            <div className="feed-share-subtitle" id="feedShareSubtitle">Выбери место и добавь подпись, если нужно.</div>
          </div>
          <button type="button" className="feed-share-closeBtn" aria-label="Закрыть" onClick={close}>
            <svg viewBox="0 0 24 24"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>

        {post ? (
          <div className="feed-share-preview">
            <div className="feed-share-previewIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93"></path><path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07"></path></svg>
            </div>
            <div className="feed-share-previewMain">
              <div className="feed-share-previewLabel">{previewAuthor}</div>
              <div className="feed-share-previewText">{previewText}</div>
            </div>
          </div>
        ) : null}

        <div className="feed-share-destinationTabs" role="tablist" aria-label="Направление репоста">
          {[
            ['profile', 'В профиль'],
            ...(COMMUNITIES_UI_ENABLED ? [['community', 'В сообщество']] : []),
            ['chat', 'В чат'],
            ['link', 'Ссылка'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={destination === key}
              className={`feed-share-destinationTab ${destination === key ? 'is-active' : ''}`}
              onClick={() => { setDestination(key); setError(''); setInlineNote(''); }}
            >
              {label}
            </button>
          ))}
        </div>

        {destination !== 'link' ? (
          <div className="feed-share-field">
            <label className="feed-share-label" htmlFor="postShareComment">Комментарий</label>
            <textarea
              id="postShareComment"
              className="feed-share-commentInput"
              value={comment}
              maxLength={420}
              placeholder={destination === 'chat' ? 'Можно добавить сообщение к отправке' : 'Можно добавить пару слов к репосту'}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
        ) : null}

        {destination === 'profile' ? (
          <div className="feed-share-choiceBlock">
            <div className="feed-share-label">Видимость</div>
            <div className="feed-share-visibilityRow">
              {[
                ['public', 'Публично'],
                ['friends', 'Друзья'],
                ['private', 'Только я'],
              ].map(([key, label]) => (
                <button key={key} type="button" className={`feed-share-pill ${visibility === key ? 'is-active' : ''}`} onClick={() => setVisibility(key)}>{label}</button>
              ))}
            </div>
          </div>
        ) : null}

        {destination === 'community' ? (
          <div className="feed-share-communityList" aria-label="Выбор сообщества">
            {communitiesLoading ? (
              <div className="feed-share-empty">Загружаем сообщества…</div>
            ) : communities.length ? communities.map((community) => {
              const selected = String(selectedCommunityId) === String(community.id);
              return (
                <button key={community.id} type="button" className={`feed-share-communityItem ${selected ? 'is-selected' : ''}`} onClick={() => setSelectedCommunityId(String(community.id))}>
                  <span className="feed-share-chatAvatar">{community.initials || String(community.name || '?').slice(0, 2)}</span>
                  <span className="feed-share-chatMain">
                    <strong>{community.name || 'Сообщество'}</strong>
                    <small>{community.role_label || community.visibility_label || 'Можно опубликовать репост'}</small>
                  </span>
                  <span className="feed-share-chatCheck" aria-hidden="true">{selected ? '✓' : '+'}</span>
                </button>
              );
            }) : (
              <div className="feed-share-empty">Нет сообществ, куда вы можете публиковать.</div>
            )}
          </div>
        ) : null}

        {destination === 'chat' ? (
          <>
            <div className="feed-share-searchRow">
              <div className="feed-share-searchBox">
                <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
                <input value={chatQuery} onChange={(event) => setChatQuery(event.target.value)} placeholder="Найти чат" />
              </div>
              <span className="feed-share-counter">{selectedChatIds.length ? `${selectedChatIds.length} выбрано` : 'чаты'}</span>
            </div>

            <div className="feed-share-chatList" aria-label="Выбор чатов для отправки">
              {chatsLoading ? (
                <div className="feed-share-empty">Загружаем чаты…</div>
              ) : chats.length ? chats.map((chat) => {
                const selected = selectedChatIds.includes(String(chat.id));
                return (
                  <button key={chat.id} type="button" className={`feed-share-chatItem ${selected ? 'is-selected' : ''}`} onClick={() => toggleChat(chat.id)}>
                    <span className="feed-share-chatAvatar">{chat.initials || String(chat.name || '?').slice(0, 2)}</span>
                    <span className="feed-share-chatMain">
                      <strong>{chat.name || 'Чат'}</strong>
                      <small>{chat.preview || chat.status || 'Можно отправить публикацию'}</small>
                    </span>
                    <span className="feed-share-chatCheck" aria-hidden="true">{selected ? '✓' : '+'}</span>
                  </button>
                );
              }) : (
                <div className="feed-share-empty">Чаты не найдены. Начни диалог в мессенджере, и он появится здесь.</div>
              )}
            </div>
          </>
        ) : null}

        {destination === 'link' ? (
          <div className="feed-share-linkBlock">
            <div className="feed-share-previewText">Ссылка ведёт на оригинальную публикацию. Отдельный репост не создаётся.</div>
            <button type="button" className="feed-share-actionBtn is-primary" onClick={copyLink}>
              <span className="feed-share-actionIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93"></path><path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07"></path></svg></span>
              <span className="feed-share-actionCopy"><strong>{inlineNote || 'Скопировать ссылку'}</strong><small>Без публикации в профиле</small></span>
            </button>
          </div>
        ) : null}

        {error ? <div className="feed-share-error" role="alert">{error}</div> : null}
        {inlineNote && destination !== 'link' ? <div className="feed-share-inlineNote" role="status">{inlineNote}</div> : null}

        {destination !== 'link' ? (
          <div className="feed-share-actions">
            {destination === 'chat' ? (
              <button type="button" className="feed-share-actionBtn is-primary" disabled={sending || !selectedChatIds.length} onClick={sendToChats}>
                <span className="feed-share-actionIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M22 2 11 13"></path><path d="m22 2-7 20-4-9-9-4 20-7z"></path></svg></span>
                <span className="feed-share-actionCopy"><strong>{sending ? 'Отправляем…' : 'Отправить в чаты'}</strong><small>Внутри мессенджера Friendscape</small></span>
              </button>
            ) : (
              <button type="button" className="feed-share-actionBtn is-primary" disabled={sending || (destination === 'community' && !selectedCommunityId)} onClick={publishRepost}>
                <span className="feed-share-actionIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14"></path><path d="M16 6l4 4-4 4"></path><path d="M20 10H9a5 5 0 0 0-5 5"></path></svg></span>
                <span className="feed-share-actionCopy"><strong>{sending ? 'Публикуем…' : destination === 'community' ? 'Опубликовать в сообществе' : 'Опубликовать в профиле'}</strong><small>{destination === 'community' ? 'Появится в выбранном сообществе' : 'Появится в ваших постах'}</small></span>
              </button>
            )}
            <div className="feed-share-secondaryActions">
              <button type="button" className="feed-share-smallBtn" onClick={copyLink}>{inlineNote || 'Скопировать ссылку'}</button>
              {onSaveToggle ? (
                <button type="button" className="feed-share-smallBtn" onClick={() => { onSaveToggle(post?.id); close(); }}>
                  {post?.is_saved ? 'Убрать из сохранённого' : 'Сохранить'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}

'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

function BellIcon() {
  return <svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"></path><path d="M10 20a2 2 0 0 0 4 0"></path></svg>;
}

function initialsOf(item) {
  const initials = String(item?.actor?.initials || '').trim();
  if (initials) return initials.slice(0, 2).toUpperCase();
  const name = String(item?.actor?.name || item?.title || 'С').trim();
  return name.charAt(0).toUpperCase() || 'С';
}

function titleOf(item) {
  const title = String(item?.title || '').trim();
  if (title) return title;
  return 'Уведомление';
}

function textOf(item) {
  const text = String(item?.text || item?.body || '').trim();
  if (text) return text;
  return 'Откройте, чтобы посмотреть подробности.';
}

function getNotificationHref(item) {
  const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
  if (payload.url) return String(payload.url);

  const entityType = String(item?.entity_type || item?.entityType || '').toLowerCase();
  const entityId = item?.entity_id ?? item?.entityId;
  const postId = payload.postId || payload.post_id || (entityType === 'post' ? entityId : null);
  const commentPostId = payload.postId || payload.post_id;
  const profileId = payload.profileId || payload.profile_id || (entityType === 'user' ? entityId : null);
  const conversationId = payload.conversationId || payload.conversation_id || (entityType === 'conversation' ? entityId : null);
  const communitySlug = payload.slug || payload.communitySlug || payload.community_slug;

  if (communitySlug) {
    const tab = payload.tab ? `?tab=${encodeURIComponent(String(payload.tab))}` : '';
    return `/communities/${encodeURIComponent(String(communitySlug))}${tab}`;
  }
  if (entityType === 'community' && entityId) return `/communities/${encodeURIComponent(String(entityId))}`;
  if (conversationId) return `/chat?conversation=${encodeURIComponent(String(conversationId))}`;
  if (postId || commentPostId) return `/feed?post=${encodeURIComponent(String(postId || commentPostId))}`;
  if (profileId) return `/profile/${encodeURIComponent(String(profileId))}`;
  return '';
}

async function getCsrfHeader() {
  try {
    const response = await fetch('/api/auth/csrf', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    const token = String(data?.csrfToken || '');
    return token ? { 'x-csrf-token': token } : {};
  } catch {
    return {};
  }
}

export default function NotificationCenter({ buttonClassName = 'icon-btn notifications-btn', buttonLabel = 'Уведомления', limit = 30 }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const closeButtonRef = useRef(null);

  const normalizedItems = useMemo(() => (Array.isArray(items) ? items : []), [items]);

  const loadNotifications = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError('');
      const response = await fetch(`/api/notifications?limit=${encodeURIComponent(String(limit))}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить уведомления.');
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setItems(nextItems);
      setUnreadCount(Number(data.unreadCount ?? data.unread_count ?? nextItems.filter((item) => item?.unread).length));
    } catch (loadError) {
      console.warn('notifications fallback enabled', loadError?.message || loadError);
      setError('');
      setItems([]);
      setUnreadCount(0);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [limit]);

  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/unread-count', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setUnreadCount(Number(data.unread_count || data.unreadCount || 0));
    } catch {}
  }, []);

  useEffect(() => {
    loadUnreadCount();
  }, [loadUnreadCount]);

  useEffect(() => {
    if (!open) return;
    loadNotifications({ silent: false });
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
  }, [open, loadNotifications]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    const eventSource = new EventSource('/api/realtime/stream');

    const upsertItem = (item) => {
      if (!item) return;
      setItems((prev) => [item, ...prev.filter((entry) => entry.id !== item.id)].slice(0, limit));
    };

    const onNotificationCreated = (evt) => {
      try {
        const payload = JSON.parse(evt.data || '{}');
        if (payload.item) upsertItem(payload.item);
        if (typeof payload.unread_count === 'number') setUnreadCount(Number(payload.unread_count || 0));
      } catch {}
    };
    const onNotificationRead = (evt) => {
      try {
        const payload = JSON.parse(evt.data || '{}');
        if (payload.item) setItems((prev) => prev.map((item) => (item.id === payload.item.id ? payload.item : item)));
        if (typeof payload.unread_count === 'number') setUnreadCount(Number(payload.unread_count || 0));
      } catch {}
    };
    const onNotificationReadAll = (evt) => {
      try {
        const payload = JSON.parse(evt.data || '{}');
        setItems((prev) => prev.map((item) => ({ ...item, unread: false })));
        setUnreadCount(Number(payload.unreadCount || payload.unread_count || 0));
      } catch {}
    };
    const onSyncUnread = (evt) => {
      try {
        const payload = JSON.parse(evt.data || '{}');
        if (typeof payload.notifications_unread === 'number') setUnreadCount(Number(payload.notifications_unread || 0));
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
  }, [limit]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const markOneRead = useCallback(async (item) => {
    if (!item?.id) return;
    const wasUnread = Boolean(item.unread);
    setItems((prev) => prev.map((entry) => (entry.id === item.id ? { ...entry, unread: false } : entry)));
    if (wasUnread) setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      const csrfHeader = await getCsrfHeader();
      const response = await fetch(`/api/notifications/${item.id}/read`, { method: 'PUT', headers: csrfHeader });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось отметить уведомление.');
      if (data.item) setItems((prev) => prev.map((entry) => (entry.id === data.item.id ? data.item : entry)));
      if (typeof data.unread_count === 'number') setUnreadCount(Number(data.unread_count || 0));
    } catch {
      loadNotifications({ silent: true });
    }
  }, [loadNotifications]);

  const markAllRead = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const previousItems = items;
    const previousUnread = unreadCount;
    setItems((prev) => prev.map((item) => ({ ...item, unread: false })));
    setUnreadCount(0);
    try {
      const csrfHeader = await getCsrfHeader();
      const response = await fetch('/api/notifications/read-all', { method: 'PUT', headers: csrfHeader });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось отметить уведомления.');
      if (typeof data.unreadCount === 'number' || typeof data.unread_count === 'number') {
        setUnreadCount(Number(data.unreadCount ?? data.unread_count ?? 0));
      }
    } catch (markError) {
      setItems(previousItems);
      setUnreadCount(previousUnread);
      setError(markError?.message || 'Не удалось отметить уведомления.');
    } finally {
      setBusy(false);
    }
  }, [busy, items, loadNotifications, unreadCount]);

  const handleItemClick = useCallback(async (item) => {
    await markOneRead(item);
    const href = getNotificationHref(item);
    setOpen(false);
    if (href) router.push(href);
  }, [markOneRead, router]);

  return (
    <>
      <button
        className={buttonClassName}
        type="button"
        aria-label={buttonLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <BellIcon />
        <span className={`notifications-badge ${unreadCount ? '' : 'is-empty'}`}>{unreadCount > 99 ? '99+' : unreadCount}</span>
      </button>

      <div className={`notifications-overlay ${open ? 'open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true"></div>
      <aside className={`notifications-sheet ${open ? 'open' : ''}`} aria-hidden={!open} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="notifications-head">
          <div>
            <div className="notifications-title" id={titleId}>Уведомления</div>
            <div className="notifications-subtitle">{unreadCount ? `${unreadCount} непрочитанных` : 'Всё прочитано'}</div>
          </div>
          <div className="notifications-actions">
            <button className="ghost-btn" type="button" onClick={markAllRead} disabled={busy || !unreadCount}>Прочитать всё</button>
            <button ref={closeButtonRef} className="ghost-btn notifications-close" type="button" onClick={() => setOpen(false)} aria-label="Закрыть">×</button>
          </div>
        </div>
        {error ? <div className="notifications-error" role="alert">{error}</div> : null}
        <div className="notifications-list" aria-busy={loading}>
          {loading ? (
            <div className="feedN-empty">Загружаем уведомления…</div>
          ) : normalizedItems.length ? normalizedItems.map((item) => {
            const href = getNotificationHref(item);
            return (
              <button
                className={`notification-item ${item.unread ? 'unread' : ''}`}
                key={item.id}
                type="button"
                onClick={() => handleItemClick(item)}
              >
                <div className="notification-avatar">{initialsOf(item)}</div>
                <div className="notification-main">
                  <div className="notification-text"><strong>{titleOf(item)}</strong></div>
                  <div className="notification-target">{textOf(item)}</div>
                  {item.target ? <div className="notification-target is-muted">{item.target}</div> : null}
                  <div className="notification-time">{item.time || 'только что'}{href ? ' · открыть' : ''}</div>
                </div>
              </button>
            );
          }) : (
            <div className="feedN-empty">Уведомлений пока нет. Здесь появятся сообщения, заявки, реакции и события сообществ.</div>
          )}
        </div>
      </aside>
    </>
  );
}

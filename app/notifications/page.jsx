'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PostAuthBottomNav from '../../components/PostAuthBottomNav';

function BellIcon() {
  return <svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"></path><path d="M10 20a2 2 0 0 0 4 0"></path></svg>;
}

function formatRelativeTime(value) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetch('/api/notifications', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить уведомления.');
      setItems(data.notifications || []);
    } catch (err) {
      setError(err.message || 'Не удалось загрузить уведомления.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const visibleItems = useMemo(() => {
    if (filter === 'unread') return items.filter((item) => !item.is_read);
    if (filter === 'social') return items.filter((item) => ['friend_request','friend_accept','follow'].includes(item.type));
    if (filter === 'activity') return items.filter((item) => ['message','comment','reaction'].includes(item.type));
    return items;
  }, [items, filter]);

  const unreadCount = items.filter((item) => !item.is_read).length;

  const openItem = async (item) => {
    try {
      if (!item.is_read) {
        await fetch(`/api/notifications/${item.id}/read`, { method: 'POST' });
        setItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry));
      }
    } catch {}
    router.push(item.href || '/notifications');
  };

  const markAllRead = async () => {
    try {
      const response = await fetch('/api/notifications/read-all', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить уведомления.');
      setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
    } catch (err) {
      setError(err.message || 'Не удалось обновить уведомления.');
    }
  };

  return (
    <div className="app-shell">
      <div className="app profile-app">
        <div className="screen notificationsPage-screen active">
          <header className="topbar glass">
            <div className="topbar-row">
              <div className="title-block">
                <div className="title-main">Уведомления</div>
                <div className="title-sub">Социальные события, реакции и новые сообщения</div>
              </div>
              <div className="notificationsPage-badge">
                <BellIcon />
                <span>{unreadCount}</span>
              </div>
            </div>
          </header>

          <div className="chips-row notificationsPage-chips">
            <button className={`chip following ${filter === 'all' ? 'active' : ''}`} type="button" onClick={() => setFilter('all')}>Все</button>
            <button className={`chip friends ${filter === 'unread' ? 'active' : ''}`} type="button" onClick={() => setFilter('unread')}>Непрочитанные</button>
            <button className={`chip global ${filter === 'social' ? 'active' : ''}`} type="button" onClick={() => setFilter('social')}>Соцсеть</button>
            <button className={`chip global ${filter === 'activity' ? 'active' : ''}`} type="button" onClick={() => setFilter('activity')}>Активность</button>
          </div>

          <section className="notificationsPage-actions">
            <button className="ghost-btn" type="button" onClick={markAllRead}>Прочитать всё</button>
            <button className="ghost-btn" type="button" onClick={load}>Обновить</button>
          </section>

          {error ? <div className="feedN-alert">{error}</div> : null}

          {loading ? (
            <div className="feedN-empty">Загружаем уведомления...</div>
          ) : visibleItems.length ? (
            <section className="notificationsPage-list">
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`notificationsPage-item ${item.is_read ? '' : 'is-unread'}`}
                  onClick={() => openItem(item)}
                >
                  <div className="notificationsPage-avatar">{item.actor_initials || item.actor_name?.charAt(0) || 'F'}</div>
                  <div className="notificationsPage-main">
                    <div className="notificationsPage-text"><strong>{item.actor_name}</strong> {item.text}</div>
                    {item.target ? <div className="notificationsPage-target">{item.target}</div> : null}
                    <div className="notificationsPage-meta">
                      <span>{formatRelativeTime(item.created_at)}</span>
                      {!item.is_read ? <span className="notificationsPage-dot"></span> : null}
                    </div>
                  </div>
                </button>
              ))}
            </section>
          ) : (
            <div className="feedN-empty">Пока нет уведомлений.</div>
          )}
        </div>

        <PostAuthBottomNav current="notifications" />
      </div>
    </div>
  );
}

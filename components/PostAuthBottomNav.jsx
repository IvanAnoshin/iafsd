'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

function FeedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="7" height="7" rx="2"></rect><rect x="14" y="4" width="7" height="7" rx="2"></rect><rect x="3" y="13" width="7" height="7" rx="2"></rect><rect x="14" y="13" width="7" height="7" rx="2"></rect></svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5"></path><path d="M6.5 9.5V20h11V9.5"></path><path d="M10 20v-5h4v5"></path></svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4A3.5 3.5 0 0 1 15.5 14H10l-4 4v-4.5A3.5 3.5 0 0 1 5 10.5z"></path></svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="9" r="3"></circle><circle cx="17" cy="10" r="2.5"></circle><path d="M4 19c1.2-2.8 3.3-4 5.8-4 2.6 0 4.6 1.2 5.8 4"></path><path d="M14.5 18c.7-1.7 2-2.7 3.8-2.7 1.1 0 2.2.4 3.2 1.7"></path></svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a2 2 0 0 1 0 4h-.2a1 1 0 0 0-.9.6z"></path></svg>
  );
}

export default function PostAuthBottomNav() {
  const pathname = usePathname();
  const [chatUnreadCount, setChatUnreadCount] = useState(0);

  useEffect(() => {
    let disposed = false;

    const loadSummary = async () => {
      try {
        const response = await fetch('/api/realtime/unread-summary', { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || disposed) return;
        setChatUnreadCount(Number(payload.chat_total || 0));
      } catch {}
    };

    loadSummary();

    const eventSource = new EventSource('/api/realtime/stream');
    const onSyncUnread = (evt) => {
      try {
        const payload = JSON.parse(evt.data || '{}');
        if (!disposed) setChatUnreadCount(Number(payload.chat_total || 0));
      } catch {}
    };
    eventSource.addEventListener('sync.unread', onSyncUnread);
    eventSource.onerror = () => {};

    return () => {
      disposed = true;
      eventSource.removeEventListener('sync.unread', onSyncUnread);
      eventSource.close();
    };
  }, []);

  const isFeed = pathname === '/feed';
  const isProfile = pathname === '/profile';
  const isChat = pathname === '/chat';
  const isPeople = pathname === '/people';
  const isSettings = pathname === '/settings' || pathname?.startsWith('/settings/');

  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      <Link href="/feed" prefetch className={`nav-btn ${isFeed ? 'active' : ''}`} aria-label="Лента" aria-current={isFeed ? 'page' : undefined}>
        <FeedIcon />
      </Link>
      <Link href="/profile" prefetch className={`nav-btn ${isProfile ? 'active' : ''}`} aria-label="Профиль" aria-current={isProfile ? 'page' : undefined}>
        <HomeIcon />
      </Link>
      <Link href="/chat" prefetch className={`nav-btn ${isChat ? 'active' : ''}`} aria-label="Чаты" aria-current={isChat ? 'page' : undefined}>
        <ChatIcon />
        {chatUnreadCount > 0 ? <span className="notifications-badge nav-badge">{chatUnreadCount > 99 ? '99+' : chatUnreadCount}</span> : null}
      </Link>
      <Link href="/people" prefetch className={`nav-btn people ${isPeople ? 'active' : ''}`} aria-label="Люди" aria-current={isPeople ? 'page' : undefined}>
        <PeopleIcon />
      </Link>
      <Link href="/settings" prefetch className={`nav-btn ${isSettings ? 'active' : ''}`} aria-label="Настройки" aria-current={isSettings ? 'page' : undefined}>
        <SettingsIcon />
      </Link>
    </nav>
  );
}

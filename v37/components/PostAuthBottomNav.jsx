'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import GearIcon from './icons/GearIcon';

function FeedIcon() {
  return (
    <svg viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="7" rx="2"></rect><rect x="14" y="4" width="7" height="7" rx="2"></rect><rect x="3" y="13" width="7" height="7" rx="2"></rect><rect x="14" y="13" width="7" height="7" rx="2"></rect></svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24"><path d="M4 10.5 12 4l8 6.5"></path><path d="M6.5 9.5V20h11V9.5"></path><path d="M10 20v-5h4v5"></path></svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24"><path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4A3.5 3.5 0 0 1 15.5 14H10l-4 4v-4.5A3.5 3.5 0 0 1 5 10.5z"></path></svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="3"></circle><circle cx="17" cy="10" r="2.5"></circle><path d="M4 19c1.2-2.8 3.3-4 5.8-4 2.6 0 4.6 1.2 5.8 4"></path><path d="M14.5 18c.7-1.7 2-2.7 3.8-2.7 1.1 0 2.2.4 3.2 1.7"></path></svg>
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

  return (
    <nav className="bottom-nav">
      <Link href="/feed" prefetch className={`nav-btn ${pathname === '/feed' ? 'active' : ''}`} aria-label="Лента">
        <FeedIcon />
      </Link>
      <Link href="/profile" prefetch className={`nav-btn ${pathname === '/profile' ? 'active' : ''}`} aria-label="Профиль">
        <HomeIcon />
      </Link>
      <Link href="/chat" prefetch className={`nav-btn ${pathname === '/chat' ? 'active' : ''}`} aria-label="Чаты">
        <ChatIcon />
        {chatUnreadCount > 0 ? <span className="notifications-badge nav-badge">{chatUnreadCount > 99 ? '99+' : chatUnreadCount}</span> : null}
      </Link>
      <Link href="/people" prefetch className={`nav-btn people ${pathname === '/people' ? 'active' : ''}`} aria-label="Люди">
        <PeopleIcon />
      </Link>
      <Link href="/settings" prefetch className={`nav-btn ${pathname === '/settings' ? 'active' : ''}`} aria-label="Настройки">
        <GearIcon />
      </Link>
    </nav>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SettingsDfsnPage() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [sessionId, setSessionId] = useState('');
  const [qualityFlags, setQualityFlags] = useState([]);
  const [statusInfo, setStatusInfo] = useState(null);
  const [completed, setCompleted] = useState(false);
  const [csrfToken, setCsrfToken] = useState('');

  const sessionIdRef = useRef('');
  const finishedRef = useRef(false);
  const typingEventsRef = useRef([]);
  const mouseEventsRef = useRef([]);
  const scrollEventsRef = useRef([]);
  const flushInFlightRef = useRef(false);
  const lastMouseSampleRef = useRef(0);
  const lastKeyTimeRef = useRef(null);
  const keyDownStartedRef = useRef(new Map());

  useEffect(() => {
    let timerId;
    let flushInterval;

    const startPage = async () => {
      try {
        const [sessionResponse, csrfResponse] = await Promise.all([
          fetch('/api/auth/session', { cache: 'no-store' }),
          fetch('/api/auth/csrf', { cache: 'no-store' }),
        ]);

        if (sessionResponse.status === 401) {
          router.replace('/');
          return;
        }

        const sessionData = await sessionResponse.json();
        if (!sessionResponse.ok) {
          throw new Error(sessionData.error || 'Не удалось подготовить DFSN-профиль.');
        }

        const csrfData = await csrfResponse.json().catch(() => ({}));
        setCsrfToken(String(csrfData.csrfToken || ''));
        setStatusInfo(sessionData.user?.dfsn || null);

        const now = new Date();
        const startResponse = await fetch('/api/auth/dfsn/setup/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfData.csrfToken ? { 'x-csrf-token': csrfData.csrfToken } : {}),
          },
          body: JSON.stringify({
            route: '/settings/dfsn',
            screen: 'settings_dfsn',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale: navigator.language,
            session_hour: now.getHours(),
            session_weekday: now.getDay(),
          }),
        });

        const startData = await startResponse.json();
        if (!startResponse.ok) {
          throw new Error(startData.error || 'Не удалось начать DFSN-настройку.');
        }

        sessionIdRef.current = startData.dfsn_session_id;
        setSessionId(startData.dfsn_session_id);
        setStarting(false);

        timerId = window.setInterval(() => {
          setSecondsLeft((current) => {
            if (current <= 1) {
              window.clearInterval(timerId);
              void finishDfsn(csrfData.csrfToken || '');
              return 0;
            }
            return current - 1;
          });
        }, 1000);

        flushInterval = window.setInterval(() => {
          void flushEvents(csrfData.csrfToken || '');
        }, 5000);
      } catch (startError) {
        setError(startError.message || 'Не удалось начать DFSN-настройку.');
        setStarting(false);
      }
    };

    const handleMouseMove = (event) => {
      if (finishedRef.current) return;
      const now = Date.now();
      if (now - lastMouseSampleRef.current < 80) return;
      lastMouseSampleRef.current = now;
      const previous = mouseEventsRef.current[mouseEventsRef.current.length - 1];
      let speed = 0;
      if (previous) {
        const dx = event.clientX - previous.x;
        const dy = event.clientY - previous.y;
        const dt = now - previous.timestamp;
        if (dt > 0) {
          speed = (Math.sqrt(dx * dx + dy * dy) / dt) * 1000;
        }
      }
      mouseEventsRef.current.push({ timestamp: now, x: event.clientX, y: event.clientY, speed });
    };

    const handleScroll = () => {
      if (finishedRef.current) return;
      const now = Date.now();
      const previous = scrollEventsRef.current[scrollEventsRef.current.length - 1];
      const currentY = window.scrollY || 0;
      const delta = previous ? currentY - previous.position : currentY;
      const dt = previous ? now - previous.timestamp : 0;
      const speed = dt > 0 ? (Math.abs(delta) / dt) * 1000 : 0;
      scrollEventsRef.current.push({ timestamp: now, delta, speed, position: currentY });
    };

    const handleKeyDown = (event) => {
      if (finishedRef.current) return;
      const now = Date.now();
      const previous = lastKeyTimeRef.current;
      const delay = previous ? now - previous : 0;
      lastKeyTimeRef.current = now;
      keyDownStartedRef.current.set(event.key, now);
      typingEventsRef.current.push({
        timestamp: now,
        key: event.key,
        delay,
        corrected: event.key === 'Backspace',
        backspace: event.key === 'Backspace',
      });
    };

    const handleKeyUp = (event) => {
      const start = keyDownStartedRef.current.get(event.key);
      if (!start) return;
      const hold = Date.now() - start;
      keyDownStartedRef.current.delete(event.key);
      const last = typingEventsRef.current[typingEventsRef.current.length - 1];
      if (last && last.key === event.key && !last.hold) {
        last.hold = hold;
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    void startPage();

    return () => {
      if (timerId) window.clearInterval(timerId);
      if (flushInterval) window.clearInterval(flushInterval);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('scroll', handleScroll);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [router]);

  const flushEvents = async (token = csrfToken) => {
    if (!sessionIdRef.current || flushInFlightRef.current || finishedRef.current) return;

    const typingEvents = [...typingEventsRef.current];
    const mouseEvents = [...mouseEventsRef.current];
    const scrollEvents = [...scrollEventsRef.current].map(({ position, ...rest }) => rest);

    if (!typingEvents.length && !mouseEvents.length && !scrollEvents.length) return;

    typingEventsRef.current = [];
    mouseEventsRef.current = [];
    scrollEventsRef.current = [];

    flushInFlightRef.current = true;
    try {
      await fetch('/api/auth/dfsn/setup/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-csrf-token': token } : {}),
        },
        body: JSON.stringify({
          dfsn_session_id: sessionIdRef.current,
          typing_events: typingEvents,
          mouse_events: mouseEvents,
          scroll_events: scrollEvents,
        }),
      });
    } finally {
      flushInFlightRef.current = false;
    }
  };

  const finishDfsn = async (token = csrfToken) => {
    if (finishedRef.current || !sessionIdRef.current) return;
    finishedRef.current = true;
    setLoading(true);
    setError('');

    try {
      await flushEvents(token);
      const response = await fetch('/api/auth/dfsn/setup/finish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-csrf-token': token } : {}),
        },
        body: JSON.stringify({
          dfsn_session_id: sessionIdRef.current,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось завершить DFSN-настройку.');
      }

      setQualityFlags(data.quality_flags || []);
      setCompleted(true);
      setStatusInfo({
        configured: true,
        trust_label: data.trust_label || 'trusted',
        updated_at: new Date().toISOString(),
      });
    } catch (finishError) {
      setError(finishError.message || 'Не удалось завершить DFSN-настройку.');
      finishedRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <main className="auth-screen">
        <div className="auth-box">
          <div className="auth-nav-row">
            <Link className="auth-back-link" href="/settings">
              Назад
            </Link>
          </div>

          <h1 className="brand-title">Friendscape</h1>
          <p className="brand-subtitle">перенастройка dfsn-профиля</p>

          <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
            <div className="dfsn-header">
              <p className="dfsn-title">Наберите текст в течение 30 секунд</p>
              <div className="dfsn-timer">{secondsLeft} сек</div>
            </div>

            <p className="dfsn-text">
              Эта сессия аккуратно обновит уже существующий DFSN-профиль и не затронет регистрационный сценарий.
            </p>
            <p className="auth-helper auth-helper-center">
              Сбор идёт только для текущей калибровки: темп набора, правки, движения мыши, скролл и контекст сессии.
            </p>

            {statusInfo ? (
              <div className="auth-message auth-message-soft">
                {statusInfo.configured ? 'Профиль уже настроен.' : 'Профиль ещё не был настроен.'}
                {statusInfo.updated_at ? ` Последнее обновление: ${new Date(statusInfo.updated_at).toLocaleString('ru-RU')}.` : ''}
              </div>
            ) : null}

            <textarea
              className="dfsn-textarea"
              placeholder={starting ? 'Подготавливаем сессию…' : 'Начните вводить текст...'}
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={loading || completed || starting}
            />

            {qualityFlags.length > 0 ? (
              <div className="auth-message auth-message-soft">
                Качество сессии: {qualityFlags.join(', ')}
              </div>
            ) : null}


            {error ? <div className="auth-message auth-message-error">{error}</div> : null}

            <button
              className="auth-button auth-button-primary"
              type="button"
              disabled={loading || completed || starting}
              onClick={() => finishDfsn()}
            >
              {starting ? 'Подготавливаем...' : loading ? 'Сохраняем...' : 'Завершить сейчас'}
            </button>

            {completed ? (
              <button className="auth-button auth-button-secondary" type="button" onClick={() => router.push('/settings')}>
                Вернуться в настройки
              </button>
            ) : null}
          </form>
        </div>
      </main>
    </div>
  );
}

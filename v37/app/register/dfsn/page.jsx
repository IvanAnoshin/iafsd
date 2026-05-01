'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

function downloadCodes(codes) {
  const content = ['Friendscape recovery codes', '', ...codes].join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'friendscape-recovery-codes.txt';
  link.click();
  URL.revokeObjectURL(url);
}

export default function DfsnPage() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [sessionId, setSessionId] = useState('');
  const registrationIdRef = useRef('');
  const sessionIdRef = useRef('');
  const [modalOpen, setModalOpen] = useState(false);
  const [backupCodes, setBackupCodes] = useState([]);
  const [qualityFlags, setQualityFlags] = useState([]);
  const [copied, setCopied] = useState(false);

  const typingEventsRef = useRef([]);
  const mouseEventsRef = useRef([]);
  const scrollEventsRef = useRef([]);
  const flushInFlightRef = useRef(false);
  const lastMouseSampleRef = useRef(0);
  const lastKeyTimeRef = useRef(null);
  const keyDownStartedRef = useRef(new Map());
  const finishedRef = useRef(false);

  useEffect(() => {
    const registrationId = sessionStorage.getItem('fs_registration_id');
    registrationIdRef.current = registrationId || '';
    if (!registrationId) {
      router.replace('/register');
      return;
    }

    let timerId;

    const startSession = async () => {
      try {
        const now = new Date();
        const response = await fetch('/api/auth/register/dfsn/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            registration_id: registrationId,
            route: '/register/dfsn',
            screen: 'register_dfsn',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale: navigator.language,
            session_hour: now.getHours(),
            session_weekday: now.getDay(),
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          setError(data.error || 'Не удалось начать DFSN-сессию.');
          return;
        }

        sessionIdRef.current = data.dfsn_session_id;
        setSessionId(data.dfsn_session_id);

        timerId = window.setInterval(() => {
          setSecondsLeft((current) => {
            if (current <= 1) {
              window.clearInterval(timerId);
              void finishDfsn();
              return 0;
            }
            return current - 1;
          });
        }, 1000);
      } catch {
        setError('Не удалось начать DFSN-сессию.');
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
      mouseEventsRef.current.push({
        timestamp: now,
        x: event.clientX,
        y: event.clientY,
        speed,
      });
    };

    const handleScroll = () => {
      if (finishedRef.current) return;
      const now = Date.now();
      const previous = scrollEventsRef.current[scrollEventsRef.current.length - 1];
      const currentY = window.scrollY || 0;
      const delta = previous ? currentY - previous.position : currentY;
      const dt = previous ? now - previous.timestamp : 0;
      const speed = dt > 0 ? (Math.abs(delta) / dt) * 1000 : 0;
      scrollEventsRef.current.push({
        timestamp: now,
        delta,
        speed,
        position: currentY,
      });
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

    const flushInterval = window.setInterval(() => {
      void flushEvents();
    }, 5000);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    void startSession();

    return () => {
      window.clearInterval(timerId);
      window.clearInterval(flushInterval);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('scroll', handleScroll);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [router]);

  const flushEvents = async () => {
    if (!sessionIdRef.current || flushInFlightRef.current) return;

    const typingEvents = [...typingEventsRef.current];
    const mouseEvents = [...mouseEventsRef.current];
    const scrollEvents = [...scrollEventsRef.current].map(({ position, ...rest }) => rest);

    if (!typingEvents.length && !mouseEvents.length && !scrollEvents.length) return;

    typingEventsRef.current = [];
    mouseEventsRef.current = [];
    scrollEventsRef.current = [];

    flushInFlightRef.current = true;
    try {
      await fetch('/api/auth/register/dfsn/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  const finishDfsn = async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setLoading(true);
    setError('');

    const registrationId = registrationIdRef.current || sessionStorage.getItem('fs_registration_id');
    const activeSessionId = sessionIdRef.current;
    if (!registrationId || !activeSessionId) {
      setError('Сессия регистрации устарела. Начните заново.');
      setLoading(false);
      finishedRef.current = false;
      return;
    }

    try {
      await flushEvents();

      const finishResponse = await fetch('/api/auth/register/dfsn/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registration_id: registrationId,
          dfsn_session_id: sessionIdRef.current,
        }),
      });

      const finishData = await finishResponse.json();
      if (!finishResponse.ok) {
        setError(finishData.error || 'Не удалось завершить DFSN-сессию.');
        setLoading(false);
        finishedRef.current = false;
        return;
      }

      setQualityFlags(finishData.quality_flags || []);

      const completeResponse = await fetch('/api/auth/register/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration_id: registrationId }),
      });

      const completeData = await completeResponse.json();
      if (!completeResponse.ok) {
        setError(completeData.error || 'Не удалось завершить регистрацию.');
        setLoading(false);
        finishedRef.current = false;
        return;
      }

      sessionStorage.removeItem('fs_registration_id');
      sessionStorage.setItem('fs_profile', JSON.stringify(completeData.user));
      sessionStorage.setItem('fs_backup_codes', JSON.stringify(completeData.backup_codes || []));
      setBackupCodes(completeData.backup_codes || []);
      setModalOpen(true);
    } catch {
      setError('Не удалось завершить регистрацию.');
      finishedRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const handleGoProfile = () => {
    router.push('/profile');
  };

  return (
    <div className="page">
      <main className="auth-screen">
        <div className="auth-box">
          <div className="auth-nav-row">
            <Link className="auth-back-link" href="/register/secret">
              Назад
            </Link>
          </div>

          <h1 className="brand-title">Friendscape</h1>
          <p className="brand-subtitle">последний шаг регистрации</p>

          <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
            <div className="dfsn-header">
              <p className="dfsn-title">Наберите текст в течение 30 секунд</p>
              <div className="dfsn-timer">{secondsLeft} сек</div>
            </div>

            <p className="dfsn-text">
              Этот шаг нужен для калибровки DFSN-профиля и будущего ML-обучения.
            </p>
            <p className="auth-helper auth-helper-center">
              Мы собираем темп набора, правки, движения мыши, скролл и контекст сессии.
            </p>

            <textarea
              className="dfsn-textarea"
              placeholder="Начните вводить текст..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={loading || modalOpen}
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
              disabled={loading || modalOpen}
              onClick={finishDfsn}
            >
              {loading ? 'Завершаем...' : 'Завершить сейчас'}
            </button>
          </form>
        </div>
      </main>

      {modalOpen ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-title">Сохраните коды восстановления</div>
            <p className="modal-text">
              Эти 10 кодов понадобятся, если доступ к аккаунту нужно будет восстановить.
            </p>

            <div className="codes-grid">
              {backupCodes.map((code) => (
                <div key={code} className="profile-code">
                  {code}
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button className="auth-button auth-button-secondary" type="button" onClick={handleCopyCodes}>
                {copied ? 'Скопировано' : 'Скопировать коды'}
              </button>
              <button className="auth-button auth-button-secondary" type="button" onClick={() => downloadCodes(backupCodes)}>
                Скачать .txt
              </button>
              <button className="auth-button auth-button-primary" type="button" onClick={handleGoProfile}>
                Перейти к профилю
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

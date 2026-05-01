'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const startedAtRef = useRef(new Date().toISOString());
  const typingEventsRef = useRef([]);
  const mouseEventsRef = useRef([]);
  const scrollEventsRef = useRef([]);
  const lastMouseSampleRef = useRef(0);
  const lastKeyTimeRef = useRef(null);
  const keyDownStartedRef = useRef(new Map());

  useEffect(() => {
    const handleMouseMove = (event) => {
      const now = Date.now();
      if (now - lastMouseSampleRef.current < 90) return;
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

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('scroll', handleScroll);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const formatName = (value) => {
    if (!value) return '';
    const trimmedStart = value.replace(/^\s+/, '');
    return trimmedStart.charAt(0).toUpperCase() + trimmedStart.slice(1);
  };

  const handleNameChange = (field) => (event) => {
    setForm((prev) => ({
      ...prev,
      [field]: formatName(event.target.value),
    }));
  };

  const handleChange = (field) => (event) => {
    setForm((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!form.firstName || !form.lastName || !form.password) {
      setError('Заполните имя, фамилию и пароль.');
      return;
    }

    try {
      setLoading(true);

      const passiveDfsn = {
        route: '/',
        screen: 'login',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: navigator.language,
        session_hour: new Date().getHours(),
        session_weekday: new Date().getDay(),
        started_at: startedAtRef.current,
        ended_at: new Date().toISOString(),
        typing_events: typingEventsRef.current.slice(-700),
        mouse_events: mouseEventsRef.current.slice(-700),
        scroll_events: scrollEventsRef.current.slice(-300).map(({ position, ...rest }) => rest),
        device_context: {
          screen_width: window.screen?.width ?? null,
          screen_height: window.screen?.height ?? null,
          hardware_concurrency: navigator.hardwareConcurrency ?? null,
          device_memory: navigator.deviceMemory ?? null,
          platform: navigator.platform ?? null,
        },
      };

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.firstName,
          last_name: form.lastName,
          password: form.password,
          passive_dfsn: passiveDfsn,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Не удалось выполнить вход.');
        return;
      }

      sessionStorage.setItem('fs_profile', JSON.stringify(data.user));
      sessionStorage.removeItem('fs_backup_codes');
      router.push('/profile');
    } catch {
      setError('Не удалось выполнить вход.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <main className="auth-screen">
        <div className="auth-box">
          <h1 className="brand-title">Friendscape</h1>
          <p className="brand-subtitle">простое начало без лишнего шума</p>
          <p className="auth-helper auth-helper-center">
            При входе мы мягко собираем обезличенные поведенческие сигналы, чтобы улучшать будущую DFSN-модель.
          </p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <input
              className="auth-input"
              type="text"
              placeholder="Имя"
              value={form.firstName}
              onChange={handleNameChange('firstName')}
              autoComplete="given-name"
            />

            <input
              className="auth-input"
              type="text"
              placeholder="Фамилия"
              value={form.lastName}
              onChange={handleNameChange('lastName')}
              autoComplete="family-name"
            />

            <input
              className="auth-input"
              type="password"
              placeholder="Пароль"
              value={form.password}
              onChange={handleChange('password')}
              autoComplete="current-password"
            />

            {error ? <div className="auth-message auth-message-error">{error}</div> : null}

            <button
              className="auth-button auth-button-primary"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Входим...' : 'Войти'}
            </button>

            <Link className="auth-button auth-button-secondary auth-button-link" href="/register">
              Зарегистрировать
            </Link>

            <Link className="auth-link" href="/forgot-password">
              Забыли пароль?
            </Link>
          </form>
        </div>
      </main>
    </div>
  );
}

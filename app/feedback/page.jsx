"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PostAuthBottomNav from '@/components/PostAuthBottomNav';

const DEFAULT_FORM = {
  category: 'beta_feedback',
  subject: '',
  message: '',
  severity: 'normal',
};

function getPageContext() {
  if (typeof window === 'undefined') return {};
  return {
    path: window.location.pathname,
    referrer: document.referrer || '',
    viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
    user_agent: navigator.userAgent || '',
  };
}

export default function FeedbackPage() {
  const router = useRouter();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [csrfToken, setCsrfToken] = useState('');
  const [status, setStatus] = useState({ tone: '', text: '' });
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/csrf', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data?.csrfToken) setCsrfToken(String(data.csrfToken));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const canSubmit = useMemo(() => {
    return String(form.message || '').trim().length >= 10 && !sending;
  }, [form.message, sending]);

  const updateField = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const submitFeedback = async (event) => {
    event.preventDefault();
    setStatus({ tone: '', text: '' });

    const message = String(form.message || '').trim();
    if (message.length < 10) {
      setStatus({ tone: 'error', text: 'Опиши проблему или идею хотя бы в 10 символах.' });
      return;
    }

    try {
      setSending(true);
      const response = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: JSON.stringify({
          category: form.category,
          subject: form.subject || (form.category === 'beta_bug' ? 'Баг в публичной бете' : 'Отзыв о публичной бете'),
          message,
          context: {
            ...getPageContext(),
            severity: form.severity,
            source: 'public_beta_feedback_page',
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Не удалось отправить отзыв.');
      setStatus({ tone: '', text: '' });
      setForm(DEFAULT_FORM);
    } catch (error) {
      setStatus({ tone: 'error', text: error?.message || 'Не удалось отправить отзыв.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page">
      <main className="screen betaFeedback-page">
        <section className="betaFeedback-hero glass">
          <div className="betaFeedback-kicker">Public beta QA</div>
          <h1>Обратная связь по бете</h1>
          <p>
            Нашёл баг, странное поведение или неудобный сценарий — отправь короткое обращение. Лучше всего указать страницу,
            что ты делал, что ожидал увидеть и что произошло на самом деле.
          </p>
        </section>

        <section className="betaFeedback-card glass" aria-labelledby="betaFeedbackFormTitle">
          <h2 id="betaFeedbackFormTitle">Новое обращение</h2>
          <form className="betaFeedback-form" onSubmit={submitFeedback}>
            <label className="betaFeedback-label">
              Тип
              <select className="betaFeedback-input" value={form.category} onChange={updateField('category')}>
                <option value="beta_feedback">Отзыв о бете</option>
                <option value="beta_bug">Баг или поломка</option>
                <option value="beta_onboarding">Первый запуск и онбординг</option>
                <option value="beta_performance">Скорость или зависание</option>
                <option value="abuse">Жалоба на поведение</option>
              </select>
            </label>

            <label className="betaFeedback-label">
              Важность
              <select className="betaFeedback-input" value={form.severity} onChange={updateField('severity')}>
                <option value="normal">Обычная</option>
                <option value="high">Мешает пользоваться</option>
                <option value="critical">Блокирует основной сценарий</option>
              </select>
            </label>

            <label className="betaFeedback-label">
              Тема
              <input
                className="betaFeedback-input"
                type="text"
                placeholder="Например: не отправляется сообщение"
                value={form.subject}
                onChange={updateField('subject')}
              />
            </label>

            <label className="betaFeedback-label">
              Описание
              <textarea
                className="betaFeedback-textarea"
                placeholder="Где произошло, какие шаги, что ожидалось и что получилось"
                value={form.message}
                onChange={updateField('message')}
              />
            </label>

            {status.text && status.tone === 'error' ? <div className="betaFeedback-status is-error" role="alert">{status.text}</div> : null}

            <div className="betaFeedback-actions">
              <button className="betaFeedback-primary" type="submit" disabled={!canSubmit}>
                {sending ? 'Отправляем…' : 'Отправить отзыв'}
              </button>
              <button className="betaFeedback-secondary" type="button" onClick={() => router.back()}>
                Назад
              </button>
            </div>
          </form>
        </section>

        <section className="betaFeedback-card glass">
          <h2>Что не стоит писать</h2>
          <p>
            Не отправляй пароли, recovery-фразы, backup-коды, private keys и другие секреты. Для безопасности такие данные
            не нужны даже при расследовании бага.
          </p>
          <Link className="betaFeedback-link" href="/safety">Открыть правила безопасности</Link>
        </section>
      </main>
      <PostAuthBottomNav />
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SecretPage() {
  const router = useRouter();
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const registrationId = sessionStorage.getItem('fs_registration_id');
    if (!registrationId) {
      router.replace('/register');
    }
  }, [router]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const registrationId = sessionStorage.getItem('fs_registration_id');

    if (!registrationId) {
      setError('Сессия регистрации устарела. Начните заново.');
      return;
    }

    if (!secret.trim()) {
      setError('Введите секретный ответ.');
      return;
    }

    try {
      setLoading(true);

      const response = await fetch('/api/auth/register/secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registration_id: registrationId,
          secret_answer: secret,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Не удалось сохранить секретный ответ.');
        return;
      }

      router.push('/register/dfsn');
    } catch {
      setError('Не удалось сохранить секретный ответ.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <main className="auth-screen">
        <div className="auth-box">
          <div className="auth-nav-row">
            <Link className="auth-back-link" href="/register">
              Назад
            </Link>
          </div>

          <h1 className="brand-title">Friendscape</h1>
          <p className="brand-subtitle">ещё один шаг до завершения регистрации</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <p className="auth-note">Мой секрет, который я не выдам никому</p>
            <p className="auth-helper auth-helper-center">
              Придумайте личный секретный ответ. Он понадобится для восстановления доступа.
            </p>

            <input
              className="auth-input"
              type="text"
              placeholder="Введите ваш секретный ответ"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />

            {error ? <div className="auth-message auth-message-error">{error}</div> : null}

            <button
              className="auth-button auth-button-primary"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Сохраняем...' : 'Продолжить'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

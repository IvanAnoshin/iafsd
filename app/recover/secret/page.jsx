'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function RecoverSecretPage() {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: '', lastName: '', secretAnswer: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const formatName = (value) => {
    if (!value) return '';
    const trimmedStart = value.replace(/^\s+/, '');
    return trimmedStart.charAt(0).toUpperCase() + trimmedStart.slice(1);
  };

  const handleNameChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: formatName(event.target.value) }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!form.firstName || !form.lastName || !form.secretAnswer) {
      setError('Введите имя, фамилию и секретный ответ.');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('/api/auth/recover/secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.firstName,
          last_name: form.lastName,
          secret_answer: form.secretAnswer,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Не удалось восстановить доступ.');
        return;
      }
      sessionStorage.setItem('fs_profile', JSON.stringify(data.user));
      router.push('/profile');
    } catch {
      setError('Не удалось восстановить доступ.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <main className="auth-screen">
        <div className="auth-box">
          <div className="auth-nav-row">
            <Link className="auth-back-link" href="/forgot-password">
              Назад
            </Link>
          </div>

          <h1 className="brand-title">Friendscape</h1>
          <p className="brand-subtitle">восстановление по секретному ответу</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <p className="auth-helper auth-helper-center">
              Этот способ подходит, если ты помнишь личный секретный ответ, указанный при регистрации.
            </p>

            <input className="auth-input" type="text" placeholder="Имя" value={form.firstName} onChange={handleNameChange('firstName')} />
            <input className="auth-input" type="text" placeholder="Фамилия" value={form.lastName} onChange={handleNameChange('lastName')} />
            <input className="auth-input" type="text" placeholder="Секретный ответ" value={form.secretAnswer} onChange={(event) => setForm((prev) => ({ ...prev, secretAnswer: event.target.value }))} />

            {error ? <div className="auth-message auth-message-error">{error}</div> : null}

            <button className="auth-button auth-button-primary" type="submit" disabled={loading}>
              {loading ? 'Проверяем...' : 'Восстановить доступ'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

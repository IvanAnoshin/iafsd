'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function RecoverPhrasePage() {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: '', lastName: '', recoveryPhrase: '' });
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

    if (!form.firstName || !form.lastName || !form.recoveryPhrase.trim()) {
      setError('Введите имя, фамилию и recovery-фразу.');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('/api/auth/recover/phrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.firstName,
          last_name: form.lastName,
          recovery_phrase: form.recoveryPhrase,
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
            <Link className="auth-back-link" href="/forgot-password">Назад</Link>
          </div>

          <h1 className="brand-title">Friendscape</h1>
          <p className="brand-subtitle">восстановление по recovery-фразе</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <p className="auth-helper auth-helper-center">
              Введите фразу, которую вы заранее сохранили в настройках безопасности. Email и телефон не требуются.
            </p>

            <input className="auth-input" type="text" placeholder="Имя" value={form.firstName} onChange={handleNameChange('firstName')} />
            <input className="auth-input" type="text" placeholder="Фамилия" value={form.lastName} onChange={handleNameChange('lastName')} />
            <textarea className="auth-input" rows={3} placeholder="например: берег искра север камень..." value={form.recoveryPhrase} onChange={(event) => setForm((prev) => ({ ...prev, recoveryPhrase: event.target.value }))} />

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

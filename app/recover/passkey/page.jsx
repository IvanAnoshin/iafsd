'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authenticateWithPasskey } from '@/lib/passkey-client';

export default function RecoverPasskeyPage() {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: '', lastName: '' });
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

    if (!form.firstName || !form.lastName) {
      setError('Введите имя и фамилию.');
      return;
    }

    try {
      setLoading(true);
      const data = await authenticateWithPasskey({ firstName: form.firstName, lastName: form.lastName });
      sessionStorage.setItem('fs_profile', JSON.stringify(data.user));
      router.push('/profile');
    } catch (passkeyError) {
      setError(passkeyError.message || 'Не удалось восстановить доступ по passkey.');
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
          <p className="brand-subtitle">восстановление через passkey</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <p className="auth-helper auth-helper-center">
              Passkey подтверждает доступ через устройство, Face ID, Touch ID или Windows Hello. Email и телефон не нужны.
            </p>

            <input className="auth-input" type="text" placeholder="Имя" value={form.firstName} onChange={handleNameChange('firstName')} />
            <input className="auth-input" type="text" placeholder="Фамилия" value={form.lastName} onChange={handleNameChange('lastName')} />

            {error ? <div className="auth-message auth-message-error">{error}</div> : null}

            <button className="auth-button auth-button-primary" type="submit" disabled={loading}>
              {loading ? 'Открываем passkey...' : 'Восстановить через passkey'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

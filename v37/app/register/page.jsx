'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

    if (!form.firstName || !form.lastName || !form.password || !form.confirmPassword) {
      setError('Заполните все поля.');
      return;
    }

    if (form.password.length < 8) {
      setError('Пароль должен быть не короче 8 символов.');
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError('Пароли не совпадают.');
      return;
    }

    try {
      setLoading(true);

      const response = await fetch('/api/auth/register/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.firstName,
          last_name: form.lastName,
          password: form.password,
          confirm_password: form.confirmPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Не удалось начать регистрацию.');
        return;
      }

      sessionStorage.setItem('fs_registration_id', data.registration_id);
      router.push('/register/secret');
    } catch {
      setError('Не удалось начать регистрацию.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <main className="auth-screen">
        <div className="auth-box">
          <h1 className="brand-title">Friendscape</h1>
          <p className="brand-subtitle">простая регистрация без лишнего шума</p>

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
              autoComplete="new-password"
            />

            <input
              className="auth-input"
              type="password"
              placeholder="Подтверждение пароля"
              value={form.confirmPassword}
              onChange={handleChange('confirmPassword')}
              autoComplete="new-password"
            />

            <div className="auth-helper">Пароль должен быть не короче 8 символов.</div>

            {error ? <div className="auth-message auth-message-error">{error}</div> : null}

            <button
              className="auth-button auth-button-primary"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Создаём аккаунт...' : 'Зарегистрироваться'}
            </button>

            <Link className="auth-link" href="/">
              Уже есть аккаунт? Войти
            </Link>
          </form>
        </div>
      </main>
    </div>
  );
}

import Link from 'next/link';

export default function ForgotPasswordPage() {
  return (
    <div className="page">
      <main className="auth-screen">
        <div className="auth-box">
          <h1 className="brand-title">Friendscape</h1>
          <p className="brand-subtitle">выберите способ восстановления доступа</p>

          <div className="recovery-list">
            <Link className="recovery-card" href="/recover/backup">
              <div className="recovery-card-title">Восстановить по резервным кодам</div>
              <div className="recovery-card-text">
                Используйте сохранённые резервные коды для входа в аккаунт.
              </div>
            </Link>

            <Link className="recovery-card" href="/recover/secret">
              <div className="recovery-card-title">Восстановить по секретному ответу</div>
              <div className="recovery-card-text">
                Подтвердите личность с помощью секретного ответа, указанного при регистрации.
              </div>
            </Link>


            <Link className="recovery-card" href="/recover/phrase">
              <div className="recovery-card-title">Восстановить по recovery-фразе</div>
              <div className="recovery-card-text">
                Используйте сохранённую фразу восстановления без email и телефона.
              </div>
            </Link>

            <Link className="recovery-card" href="/recover/passkey">
              <div className="recovery-card-title">Восстановить через passkey</div>
              <div className="recovery-card-text">
                Используйте системный ключ устройства, Face ID, Touch ID или Windows Hello.
              </div>
            </Link>

            <Link className="recovery-card" href="/recover/trusted-device">
              <div className="recovery-card-title">Восстановить с доверенного устройства</div>
              <div className="recovery-card-text">
                Подтвердите вход PIN-кодом устройства, которому сервис уже доверяет.
              </div>
            </Link>
            <Link className="recovery-card" href="/recover/support">
              <div className="recovery-card-title">Обратиться в поддержку</div>
              <div className="recovery-card-text">
                Если кодов и ответа нет, отправьте запрос в поддержку.
              </div>
            </Link>
          </div>

          <Link className="auth-button auth-button-secondary auth-button-link" href="/">
            Назад ко входу
          </Link>
        </div>
      </main>
    </div>
  );
}

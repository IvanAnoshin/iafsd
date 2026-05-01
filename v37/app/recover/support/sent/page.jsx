import Link from 'next/link';

export default function SupportRequestSentPage() {
  return (
    <div className="page">
      <main className="auth-screen">
        <div className="auth-box">
          <h1 className="brand-title">Friendscape</h1>
          <p className="brand-subtitle">заявка отправлена</p>

          <div className="auth-form">
            <p className="auth-note auth-note-center">
              Ваша заявка будет рассмотрена и обработана.
            </p>
            <p className="auth-helper auth-helper-center">
              Когда восстановление будет доступно, вы сможете снова войти в аккаунт.
            </p>

            <Link className="auth-button auth-button-primary auth-button-link" href="/">
              На страницу входа
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

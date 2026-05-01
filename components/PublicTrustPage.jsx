import Link from 'next/link';
import { publicTrustNav } from '@/lib/public-trust-pages';

export default function PublicTrustPage({ page }) {
  return (
    <main className="trustPage">
      <section className="trustHero" aria-labelledby="trust-page-title">
        <div className="trustTopline">
          <Link className="trustBackLink" href="/">← Friendscape</Link>
          <span className="trustUpdated">Обновлено: {page.updated}</span>
        </div>
        <p className="trustEyebrow">{page.eyebrow}</p>
        <h1 className="trustTitle" id="trust-page-title">{page.title}</h1>
        <p className="trustSubtitle">{page.subtitle}</p>
      </section>

      <nav className="trustNav" aria-label="Публичные документы Friendscape">
        {publicTrustNav.map((item) => (
          <Link
            key={item.path}
            className={`trustNavLink ${item.path === page.path ? 'active' : ''}`}
            href={item.path}
            aria-current={item.path === page.path ? 'page' : undefined}
          >
            {item.eyebrow}
          </Link>
        ))}
      </nav>

      <section className="trustNotice">
        <strong>Важно про DFSN:</strong> мы объясняем пользователям назначение защитного слоя, но не раскрываем внутренние метрики, пороги, веса сигналов и правила антиобхода.
      </section>

      <article className="trustContent">
        {page.sections.map((section) => (
          <section className="trustCard" key={section.title}>
            <h2>{section.title}</h2>
            {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
      </article>
    </main>
  );
}

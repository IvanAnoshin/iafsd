'use client';

import { useEffect, useState } from 'react';
import GearIcon from './icons/GearIcon';

export default function PostAuthHeader({
  firstLetter,
  fullName,
  description,
  details = [],
  onEdit = null,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    const close = () => setMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  return (
    <header className="profile-bio-card post-auth-header-card">
      <div className="profile-header">
        <div className="profile-avatar">{firstLetter}</div>

        <div className="profile-info">
          <div className="profile-top-row">
            <div className="profile-name">{fullName}</div>

            <div
              className={`profile-menu ${menuOpen ? 'open' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="profile-menu-toggle profile-menu-gear"
                type="button"
                aria-label="Настройки профиля"
                onClick={() => setMenuOpen((prev) => !prev)}
              >
<GearIcon />
              </button>

              <div className="profile-menu-dropdown">
                <button className="profile-menu-btn" type="button" onClick={() => { setMenuOpen(false); onEdit?.(); }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
                  </svg>
                  <span>Редактировать</span>
                </button>

                <button className="profile-menu-btn" type="button" onClick={() => { setMenuOpen(false); onEdit?.(); }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="18" cy="5" r="3"></circle>
                    <circle cx="6" cy="12" r="3"></circle>
                    <circle cx="18" cy="19" r="3"></circle>
                    <path d="M8.6 13.5 15.4 17.5"></path>
                    <path d="M15.4 6.5 8.6 10.5"></path>
                  </svg>
                  <span>Поделиться</span>
                </button>
              </div>
            </div>
          </div>

          <div className="profile-details">
            <div className="profile-detail-item">
              <span className="profile-detail-label">Описание:</span>
              <span>{description}</span>
            </div>

            <div className={`profile-extra ${showMore ? 'open' : ''}`}>
              {details.map((detail) => (
                <div className="profile-detail-item" key={detail.label}>
                  <span className="profile-detail-label">{detail.label}:</span>
                  <span>{detail.value}</span>
                </div>
              ))}
            </div>

            <button
              className="profile-more-btn"
              type="button"
              onClick={() => setShowMore((prev) => !prev)}
            >
              {showMore ? 'Скрыть' : 'Показать больше'}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

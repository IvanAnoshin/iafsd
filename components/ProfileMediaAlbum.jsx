'use client';

import { useMemo, useState } from 'react';

function formatDateTime(value) {
  if (!value) return 'Только что';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Только что';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const filterLabels = {
  all: 'Всё',
  photos: 'Фото',
  videos: 'Видео',
  cards: 'Карточки',
};

function mediaKindLabel(kind) {
  if (kind === 'video') return 'Видео';
  if (kind === 'card') return 'Карточка';
  return 'Фото';
}

export default function ProfileMediaAlbum({
  title = 'Альбом',
  subtitle = '',
  items = [],
  counts = { all: 0, photos: 0, videos: 0, cards: 0 },
  filter = 'all',
  onFilterChange,
  gridMode = 'comfortable',
  onGridModeChange,
  showCards = true,
  onToggleShowCards,
  loading = false,
  error = '',
  saving = false,
  persistLabel = '',
}) {
  const [selectedId, setSelectedId] = useState(null);

  const visibleItems = useMemo(() => items.filter((item) => {
    if (!showCards && item.kind === 'card') return false;
    if (filter === 'photos') return item.kind === 'photo';
    if (filter === 'videos') return item.kind === 'video';
    if (filter === 'cards') return item.kind === 'card';
    return true;
  }), [filter, items, showCards]);

  const selectedItem = visibleItems.find((item) => item.id === selectedId) || null;

  return (
    <section className="profileClean-card profileClean-galleryCard">
      <div className="profileClean-sectionHead profileClean-galleryHead">
        <div>
          <h2 className="profileClean-sectionTitle">{title}</h2>
          {subtitle ? <p className="profileClean-sectionText">{subtitle}</p> : null}
        </div>
        <div className="profileClean-counterPill">{visibleItems.length || counts.all || 0}</div>
      </div>

      <div className="profileAlbum-toolbar">
        <div className="profileAlbum-filters">
          {Object.entries(filterLabels).map(([value, label]) => {
            const count = counts?.[value] ?? counts?.all ?? 0;
            return (
              <button
                key={value}
                type="button"
                className={`profileAlbum-filter ${filter === value ? 'is-active' : ''}`}
                onClick={() => onFilterChange?.(value)}
              >
                {label}
                <span>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="profileAlbum-modes">
          <button
            type="button"
            className={`profileAlbum-modeBtn ${gridMode === 'comfortable' ? 'is-active' : ''}`}
            onClick={() => onGridModeChange?.('comfortable')}
            aria-label="Крупная сетка"
          >
            ▦
          </button>
          <button
            type="button"
            className={`profileAlbum-modeBtn ${gridMode === 'compact' ? 'is-active' : ''}`}
            onClick={() => onGridModeChange?.('compact')}
            aria-label="Плотная сетка"
          >
            ▩
          </button>
          {onToggleShowCards ? (
            <button
              type="button"
              className={`profileAlbum-modeBtn ${showCards ? 'is-active' : ''}`}
              onClick={() => onToggleShowCards(!showCards)}
            >
              Карточки
            </button>
          ) : null}
        </div>
      </div>

      {persistLabel ? <div className="profileAlbum-hint">{saving ? 'Сохраняем вид альбома…' : persistLabel}</div> : null}
      {error ? <div className="profileClean-alert is-error">{error}</div> : null}

      {loading ? (
        <div className="profileClean-emptyState">Загрузка альбома…</div>
      ) : visibleItems.length ? (
        <div className={`profileAlbum-grid is-${gridMode}`}>
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="profileAlbum-tile"
              onClick={() => setSelectedId(item.id)}
            >
              <div className="profileAlbum-visual" style={{ background: item.preview }}>
                <div className="profileAlbum-topline">
                  <span className={`profileClean-mediaBadge is-${item.kind}`}>{mediaKindLabel(item.kind)}</span>
                  {item.duration ? <span className="profileClean-mediaBadge is-muted">{item.duration}</span> : null}
                </div>
                <div className="profileAlbum-bottomline">
                  <div className="profileAlbum-title">{item.title || 'Материал профиля'}</div>
                  {item.subtitle ? <div className="profileAlbum-subtitle">{item.subtitle}</div> : null}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="profileClean-emptyState">В альбоме пока пусто. Когда в профиль попадут фото и видео, они соберутся здесь автоматически.</div>
      )}

      {selectedItem ? (
        <div className="profileClean-lightbox" onClick={() => setSelectedId(null)}>
          <div className="profileClean-lightboxDialog" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="profileClean-lightboxClose" aria-label="Закрыть" onClick={() => setSelectedId(null)}>×</button>
            <div className="profileClean-lightboxVisual" style={{ background: selectedItem.preview }}>
              {selectedItem.kind === 'video' ? <div className="profileClean-lightboxPlay">▶</div> : null}
            </div>
            <div className="profileClean-lightboxBody">
              <div className="profileClean-lightboxTopline">
                <span className={`profileClean-mediaBadge is-${selectedItem.kind}`}>{mediaKindLabel(selectedItem.kind)}</span>
                <span className="profileClean-lightboxDate">{formatDateTime(selectedItem.createdAt)}</span>
              </div>
              <h3 className="profileClean-lightboxTitle">{selectedItem.title || 'Материал профиля'}</h3>
              {selectedItem.subtitle ? <p className="profileClean-lightboxText">{selectedItem.subtitle}</p> : null}
              {selectedItem.location ? <div className="profileClean-helpText">{selectedItem.location}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

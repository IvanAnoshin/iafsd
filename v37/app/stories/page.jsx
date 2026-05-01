'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { buildStoriesHref, getStoryInitials, getStoryTone } from '@/lib/stories-foundation';

const DEFAULT_DURATION_MINUTES = 24 * 60;
const DEFAULT_VIEWER_DURATION_MS = 5200;
const MIN_VIEWER_VIDEO_MS = 4500;
const MAX_VIEWER_VIDEO_MS = 15000;
const MINUTE_OPTIONS = Array.from({ length: 50 }, (_, index) => index + 10);
const HOUR_OPTIONS = Array.from({ length: 48 }, (_, index) => index + 1);
const DURATION_PRESETS = [30, 60, 12 * 60, 24 * 60, 48 * 60];

function PlayIcon() {
  return <svg viewBox="0 0 24 24"><path d="m9 7 8 5-8 5z"></path></svg>;
}

function PauseIcon() {
  return <svg viewBox="0 0 24 24"><path d="M9 6v12"></path><path d="M15 6v12"></path></svg>;
}

function ReplyIcon() {
  return <svg viewBox="0 0 24 24"><path d="m10 8-5 4 5 4"></path><path d="M19 18v-2a4 4 0 0 0-4-4H5"></path></svg>;
}

function CameraIcon() {
  return <svg viewBox="0 0 24 24"><path d="M4 8a2 2 0 0 1 2-2h2l1.2-2h5.6L16 6h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"></path><circle cx="12" cy="12" r="3.5"></circle></svg>;
}

function GalleryIcon() {
  return <svg viewBox="0 0 24 24"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"></path><path d="m8 14 2-2 4 4"></path><path d="m13 12 1.5-1.5L18 14"></path><circle cx="9" cy="9" r="1"></circle></svg>;
}

function TimeIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l2.5 2.5"></path></svg>;
}

function RetryIcon() {
  return <svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"></path><path d="M20 4v6h-6"></path></svg>;
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>;
}

function MinusIcon() {
  return <svg viewBox="0 0 24 24"><path d="M5 12h14"></path></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24"><path d="m6 6 12 12"></path><path d="m18 6-12 12"></path></svg>;
}


function isRenderableMoment(item) {
  if (!item) return false;
  const kind = String(item.kind || '').trim().toLowerCase();
  if (kind === 'text') return true;
  return Boolean(String(item.media_url || item.preview_url || '').trim());
}

function formatMomentTime(value) {
  if (!value) return 'только что';
  try {
    return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'только что';
  }
}

function formatDurationLabel(durationMinutes) {
  const total = Number(durationMinutes || 0) || DEFAULT_DURATION_MINUTES;
  if (total < 60) return `${total} ${total === 1 ? 'минута' : total >= 2 && total <= 4 ? 'минуты' : 'минут'}`;
  const hours = Math.round(total / 60);
  return `${hours} ${hours === 1 ? 'час' : hours >= 2 && hours <= 4 ? 'часа' : 'часов'}`;
}

function formatTimeLeftLabel(timeLeftMs) {
  const safe = Math.max(0, Number(timeLeftMs || 0));
  const totalMinutes = Math.ceil(safe / 60000);
  if (!totalMinutes) return 'истекает скоро';
  if (totalMinutes < 60) return `ещё ${formatDurationLabel(totalMinutes)}`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!minutes) return `ещё ${formatDurationLabel(hours * 60)}`;
  return `ещё ${hours} ч ${minutes} мин`;
}

function formatMomentStatLabel(value, singular, paucal, plural) {
  const count = Number(value || 0) || 0;
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? singular : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? paucal : plural;
  return `${count} ${word}`;
}

function getMomentPlaybackDuration(item) {
  if (!item) return DEFAULT_VIEWER_DURATION_MS;
  if (String(item.kind || '').toLowerCase() !== 'video') return DEFAULT_VIEWER_DURATION_MS;
  const raw = Number(item.duration_ms || item.media_duration_ms || 0);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_VIEWER_DURATION_MS;
  return Math.max(MIN_VIEWER_VIDEO_MS, Math.min(MAX_VIEWER_VIDEO_MS, raw));
}

function DurationPicker({ open, mode, value, busy, onSelectMode, onChangeValue, onClose, onConfirm }) {
  if (!open) return null;
  const options = mode === 'minutes' ? MINUTE_OPTIONS : HOUR_OPTIONS;
  return (
    <div className="storyHub-pickerBackdrop" onClick={busy ? undefined : onClose}>
      <div className="storyHub-pickerCard" onClick={(event) => event.stopPropagation()}>
        <div className="storyHub-pickerHead">
          <div>
            <div className="storyHub-badge">Время жизни</div>
            <h3>Выберите срок</h3>
          </div>
          <button type="button" className="storyHub-pickerClose" onClick={onClose} disabled={busy}>×</button>
        </div>
        <div className="storyHub-pickerModeRow">
          <button type="button" className={`storyHub-pickerMode ${mode === 'minutes' ? 'is-active' : ''}`} onClick={() => onSelectMode('minutes')} disabled={busy}>Минуты</button>
          <button type="button" className={`storyHub-pickerMode ${mode === 'hours' ? 'is-active' : ''}`} onClick={() => onSelectMode('hours')} disabled={busy}>Часы</button>
        </div>
        <div className="storyHub-wheel">
          <div className="storyHub-wheelViewport">
            <select className="storyHub-wheelSelect" size={5} value={String(value)} onChange={(event) => onChangeValue(Number(event.target.value))} disabled={busy}>
              {options.map((option) => <option key={option} value={option}>{mode === 'minutes' ? `${option} мин` : `${option} ${option === 1 ? 'час' : option >= 2 && option <= 4 ? 'часа' : 'часов'}`}</option>)}
            </select>
          </div>
        </div>
        <div className="storyHub-pickerActions">
          <button type="button" className="storyHub-ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" className="storyHub-primary" onClick={onConfirm} disabled={busy}>Готово</button>
        </div>
      </div>
    </div>
  );
}

function ViewerPreviewCard({ item, direction = 'next', onSelect }) {
  if (!item) return <div className={`storyHub-sidePreview is-${direction} is-empty`} />;
  const tone = item.author?.tone || getStoryTone(item.author?.id || item.id);
  const initials = getStoryInitials(item.author?.name || 'Момент');
  const mediaSrc = item.preview_url || item.media_url || '';
  return (
    <button type="button" className={`storyHub-sidePreview is-${direction}`} onClick={onSelect} aria-label={direction === 'prev' ? 'Предыдущий момент' : 'Следующий момент'}>
      <div className={`storyHub-sidePreviewCanvas is-${tone}`}>
        {mediaSrc ? <img src={mediaSrc} alt={item.title || 'Момент'} className="storyHub-sidePreviewMedia" /> : null}
        <div className="storyHub-sidePreviewShade"></div>
        <div className="storyHub-sidePreviewMeta">
          <div className={`storyHub-sidePreviewAvatar is-${tone}`}><span>{initials}</span></div>
          <div className="storyHub-sidePreviewText">
            <strong>{item.author?.name || 'Момент'}</strong>
            <span>{item.title || 'Момент'}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function Viewer({ stories, activeIndex, activeProgress, paused, uiHidden = false, swipeOffsetY = 0, reacting, deleting = false, onTogglePause, onPrev, onNext, onJumpToIndex, onClose, onReply, replying = false, onReact, onDelete, onOpenExtend, extending = false, timeLeftLabel = '', extensionsLeft = 0, ownerSummary = null, onHoldStart, onHoldEnd, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }) {
  const active = stories[activeIndex] || stories[0] || null;
  if (!active) return null;
  const tone = active.author?.tone || getStoryTone(active.author?.id || active.id);
  const initials = getStoryInitials(active.author?.name || 'Момент');
  const mediaSrc = active.media_url || active.preview_url || '';
  const isVideo = active.kind === 'video' && Boolean(mediaSrc);
  const hasMedia = Boolean(mediaSrc);
  const canExtend = Boolean(active.is_mine && active.can_extend);
  const prevIndex = activeIndex > 0 ? activeIndex - 1 : -1;
  const nextIndex = activeIndex < stories.length - 1 ? activeIndex + 1 : -1;
  const prevStory = prevIndex >= 0 ? stories[prevIndex] : null;
  const nextStory = nextIndex >= 0 ? stories[nextIndex] : null;
  const cardStyle = swipeOffsetY > 0 ? { transform: `translate3d(0, ${Math.round(swipeOffsetY)}px, 0) scale(${Math.max(0.92, 1 - swipeOffsetY / 1200).toFixed(3)})` } : undefined;
  return (
    <section className={`storyHub-viewerShell ${uiHidden ? 'is-uiHidden' : ''} ${swipeOffsetY > 0 ? 'is-swiping' : ''}`}>
      <div className="storyHub-viewerDeck">
        <ViewerPreviewCard item={prevStory} direction="prev" onSelect={() => onJumpToIndex(prevIndex)} />
        <article
          className={`storyHub-viewerCard storyHub-viewerCardOverlay ${uiHidden ? 'is-uiHidden' : ''}`}
          style={cardStyle}
          onPointerDown={onHoldStart}
          onPointerUp={onHoldEnd}
          onPointerCancel={onHoldEnd}
          onPointerLeave={onHoldEnd}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
        >
          <div className="storyHub-stage storyHub-stageViewer is-desktopOverlay is-cover">
            {isVideo ? (
              <video src={mediaSrc} className="storyHub-stageMedia" autoPlay muted playsInline loop />
            ) : hasMedia ? (
              <img src={mediaSrc} alt={active.title || 'Момент'} className="storyHub-stageMedia" />
            ) : (
              <div className="storyHub-textBackdrop"></div>
            )}
            <div className="storyHub-stageShade"></div>
            <div className="storyHub-viewerTop storyHub-viewerTopOverlay">
              <div className="storyHub-progressRow is-dynamic">
                {stories.map((story, index) => {
                  const progress = index < activeIndex ? 1 : index === activeIndex ? activeProgress : 0;
                  return (
                    <span key={story.id} className={`storyHub-progress ${index < activeIndex ? 'is-complete' : ''} ${index === activeIndex ? 'is-current' : ''}`}>
                      <span className="storyHub-progressFill" style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}></span>
                    </span>
                  );
                })}
              </div>
              <div className="storyHub-viewerMeta storyHub-viewerMetaOverlay">
                <div className={`storyHub-avatar is-${tone}`}><span>{initials}</span></div>
                <div className="storyHub-viewerMetaBlock">
                  <div className="storyHub-viewerName">{active.author?.name || 'Момент'}</div>
                  <div className="storyHub-viewerSub">{formatMomentTime(active.created_at)}{active.seen ? ' · просмотрено' : ''}</div>
                  <div className="storyHub-viewerLifetime">{timeLeftLabel || 'ещё немного'}{active.is_mine ? ` · Продлений осталось: ${extensionsLeft}` : ''}</div>
                  <div className="storyHub-viewerMetaPills">
                    <span className="storyHub-viewerMetaPill">{activeIndex + 1} / {stories.length}</span>
                    <span className={`storyHub-viewerMetaPill ${active.is_mine ? 'is-owner' : 'is-foreign'}`}>{active.is_mine ? 'Ваш момент' : 'Момент друга'}</span>
                  </div>
                </div>
                <button type="button" className="storyHub-viewerChrome" onClick={onTogglePause} aria-label={paused ? 'Продолжить' : 'Пауза'}>
                  {paused ? <PlayIcon /> : <PauseIcon />}
                </button>
                <button type="button" className="storyHub-viewerChrome" onClick={onClose} aria-label="Закрыть">
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div className="storyHub-stageOverlay storyHub-stageOverlayViewer">
              <div className="storyHub-stageBadge">{isVideo ? 'Видео' : hasMedia ? 'Фото' : 'Момент'}</div>
              <h3 className="storyHub-viewerTitle">{active.title || 'Момент'}</h3>
              <p className="storyHub-viewerCaption">{active.subtitle || 'Быстрый момент без лишних экранов.'}</p>
              {active.is_mine && ownerSummary ? (
                <div className="storyHub-ownerSummary" aria-label="Сводка по моменту">
                  <div className="storyHub-ownerSummaryItem">
                    <strong>{ownerSummary.views}</strong>
                    <span>{formatMomentStatLabel(ownerSummary.views, 'просмотр', 'просмотра', 'просмотров')}</span>
                  </div>
                  <div className="storyHub-ownerSummaryItem">
                    <strong>{ownerSummary.replies}</strong>
                    <span>{formatMomentStatLabel(ownerSummary.replies, 'ответ', 'ответа', 'ответов')}</span>
                  </div>
                  <div className="storyHub-ownerSummaryItem is-plus">
                    <strong>+{ownerSummary.plus}</strong>
                    <span>плюсов</span>
                  </div>
                  <div className="storyHub-ownerSummaryItem is-minus">
                    <strong>-{ownerSummary.minus}</strong>
                    <span>минусов</span>
                  </div>
                </div>
              ) : null}
            </div>
            {!hasMedia ? (
              <div className="storyHub-emptyMediaState">
                <div className={`storyHub-avatar is-${tone}`}><span>{initials}</span></div>
                <strong>{active.title || 'Момент'}</strong>
                <p>{active.subtitle || 'Контент момента скоро появится.'}</p>
              </div>
            ) : null}
            <button type="button" className="storyHub-stageHitZone is-prev" onClick={onPrev} aria-label="Предыдущий момент"></button>
            <button type="button" className="storyHub-stageHitZone is-next" onClick={onNext} aria-label="Следующий момент"></button>
          </div>
          <div className="storyHub-viewerActions storyHub-viewerActionsOverlay">
            {active.is_mine ? (
              <>
                <button type="button" className="storyHub-viewerAction is-primary" onClick={onOpenExtend} disabled={!canExtend || extending}>
                  <TimeIcon />
                  <span>{canExtend ? (extending ? 'Продлеваем…' : 'Продлить') : 'Продления недоступны'}</span>
                </button>
                <button type="button" className="storyHub-viewerAction is-danger" onClick={onDelete} disabled={deleting}>
                  <span>{deleting ? 'Удаляем…' : 'Удалить'}</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" className="storyHub-viewerAction is-primary" onClick={onReply} disabled={replying}>
                  <ReplyIcon />
                  <span>{replying ? 'Открываем чат…' : 'Ответить'}</span>
                </button>
                <button type="button" className={`storyHub-reactionAction ${active.my_reaction === 'plus' ? 'is-active is-plus' : ''}`} onClick={() => onReact('plus')} disabled={reacting}>
                  <PlusIcon />
                  <span>{active.plus_count || 0}</span>
                </button>
                <button type="button" className={`storyHub-reactionAction ${active.my_reaction === 'minus' ? 'is-active is-minus' : ''}`} onClick={() => onReact('minus')} disabled={reacting}>
                  <MinusIcon />
                  <span>{active.minus_count || 0}</span>
                </button>
              </>
            )}
          </div>
        </article>
        <ViewerPreviewCard item={nextStory} direction="next" onSelect={() => onJumpToIndex(nextIndex)} />
      </div>
    </section>
  );
}

function Composer({ draft, uploadState, publishing, onCamera, onGallery, onClear, onPublish, onChangeSubtitle, onOpenDurationPicker, onSelectPreset, onRetryUpload, onBackToFeed }) {
  const hasMedia = Boolean(draft.media?.url);
  const isVideo = (draft.media?.mime || '').startsWith('video/');
  const charsLeft = Math.max(0, 280 - String(draft.subtitle || '').length);
  const hasError = Boolean(uploadState.error);
  const statusLabel = publishing ? 'Публикуем момент…' : uploadState.loading ? 'Загружаем медиа…' : hasMedia ? (isVideo ? 'Видео готово к публикации' : 'Фото готово к публикации') : 'Сначала выберите камеру или галерею';
  return (
    <section className="storyHub-composerCard storyHub-composerCardCompact">
      <div className="storyHub-composerHead">
        <div>
          <div className="storyHub-badge">Создать момент</div>
          <h2>Снять и опубликовать</h2>
          <p>Один спокойный сценарий: камера или галерея, предпросмотр, подпись и публикация.</p>
        </div>
      </div>

      <div className={`storyHub-stage storyHub-stageComposer is-${isVideo ? 'video' : hasMedia ? 'photo' : 'text'}`}>
        {hasMedia ? (
          isVideo ? <video src={draft.media.url} className="storyHub-stageMedia" autoPlay muted playsInline loop /> : <img src={draft.media.preview_url || draft.media.url} alt="Предпросмотр момента" className="storyHub-stageMedia" />
        ) : <div className="storyHub-textBackdrop"></div>}
        <div className="storyHub-stageOverlay">
          <div className="storyHub-stageBadge">{hasMedia ? (isVideo ? 'Видео' : 'Фото') : 'Новый момент'}</div>
          <h3>{hasMedia ? 'Предпросмотр момента' : 'Начните с камеры'}</h3>
          <p>{draft.subtitle || (hasMedia ? 'Проверьте кадр, при желании добавьте подпись и выберите срок жизни.' : 'Сделайте фото, короткое видео или выберите готовое медиа из галереи.')}</p>
        </div>
      </div>

      {!hasMedia ? (
        <div className="storyHub-sourceGrid">
          <button type="button" className="storyHub-sourceCard is-primary" onClick={onCamera} disabled={uploadState.loading || publishing}>
            <span className="storyHub-sourceIcon"><CameraIcon /></span>
            <strong>Снять сейчас</strong>
            <span>Фото или короткое видео сразу из камеры.</span>
          </button>
          <button type="button" className="storyHub-sourceCard" onClick={onGallery} disabled={uploadState.loading || publishing}>
            <span className="storyHub-sourceIcon"><GalleryIcon /></span>
            <strong>Из галереи</strong>
            <span>Выбрать уже готовое фото или видео.</span>
          </button>
        </div>
      ) : (
        <div className="storyHub-mediaToolbar">
          <button type="button" className="storyHub-ghost" onClick={onCamera} disabled={uploadState.loading || publishing}><CameraIcon /><span>Переснять</span></button>
          <button type="button" className="storyHub-ghost" onClick={onGallery} disabled={uploadState.loading || publishing}><GalleryIcon /><span>Заменить</span></button>
          <button type="button" className="storyHub-ghost is-danger" onClick={onClear} disabled={uploadState.loading || publishing}>Убрать</button>
        </div>
      )}

      <div className="storyHub-fieldStack">
        <div className="storyHub-createStatusRow">
          <div className={`storyHub-createStatus ${hasError ? 'is-error' : publishing ? 'is-busy' : uploadState.loading ? 'is-busy' : hasMedia ? 'is-ready' : 'is-idle'}`}>
            <span className="storyHub-createStatusDot"></span>
            <span>{statusLabel}</span>
          </div>
          {hasError && onRetryUpload ? (
            <button type="button" className="storyHub-inlineAction" onClick={onRetryUpload} disabled={uploadState.loading || publishing}>
              <RetryIcon />
              <span>Повторить</span>
            </button>
          ) : null}
        </div>
        <button type="button" className="storyHub-settingButton" onClick={onOpenDurationPicker} disabled={publishing || uploadState.loading}>
          <span>Время жизни</span>
          <strong>{formatDurationLabel(draft.durationMinutes)}</strong>
        </button>
        <div className="storyHub-presets">
          {DURATION_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`storyHub-presetChip ${draft.durationMinutes === preset ? 'is-active' : ''}`}
              onClick={() => onSelectPreset(preset)}
              disabled={publishing || uploadState.loading}
            >
              {formatDurationLabel(preset)}
            </button>
          ))}
        </div>
        <div className="storyHub-settingHint">Быстрые пресеты для частых сценариев. Точное время можно докрутить через селектор.</div>
        <div className="storyHub-durationSummary">
          <span className="storyHub-durationSummaryPrimary">{formatDurationLabel(draft.durationMinutes)}</span>
          <span className="storyHub-durationSummaryMeta">до 2 продлений после публикации</span>
        </div>
        <label className="storyHub-textareaField">
          <span className="storyHub-textareaLabel">Подпись</span>
          <textarea className="storyHub-textarea" value={draft.subtitle} onChange={(event) => onChangeSubtitle(event.target.value)} placeholder="Подпись к моменту (необязательно)" maxLength={280} rows={3} />
          <span className="storyHub-textareaMeta">{charsLeft} символов осталось</span>
        </label>
        {uploadState.error ? <div className="storyHub-uploadError">{uploadState.error}</div> : null}
      </div>

      <div className="storyHub-composerActions storyHub-composerActionsSplit">
        <button type="button" className="storyHub-ghost" onClick={onBackToFeed} disabled={publishing || uploadState.loading}>В ленту</button>
        <button type="button" className="storyHub-primary" onClick={onPublish} disabled={publishing || uploadState.loading || !hasMedia}>{publishing ? 'Публикуем…' : 'Опубликовать момент'}</button>
      </div>
    </section>
  );
}

export default function StoriesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get('source') || 'feed';
  const mode = searchParams.get('mode') || 'viewer';
  const userId = searchParams.get('user') || '';
  const storyId = searchParams.get('story') || '';

  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const cameraAutoTriggeredRef = useRef(false);
  const lastUploadFileRef = useRef(null);
  const holdPauseTimerRef = useRef(null);
  const viewerTouchStateRef = useRef({ active: false, startX: 0, startY: 0, dragging: false });
  const progressStateRef = useRef({ storyId: '', startedAt: 0, pauseStartedAt: 0, pausedMs: 0, progress: 0 });

  const [csrfToken, setCsrfToken] = useState('');
  const [storiesPayload, setStoriesPayload] = useState({ items: [] });
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [viewerManualPaused, setViewerManualPaused] = useState(false);
  const [viewerHoldPaused, setViewerHoldPaused] = useState(false);
  const [viewerUiHidden, setViewerUiHidden] = useState(false);
  const [viewerSwipeOffsetY, setViewerSwipeOffsetY] = useState(0);
  const [viewerProgress, setViewerProgress] = useState(0);
  const [replying, setReplying] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [extending, setExtending] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadState, setUploadState] = useState({ loading: false, error: '' });
  const [draft, setDraft] = useState({ subtitle: '', media: null, durationMinutes: DEFAULT_DURATION_MINUTES });
  const [pickerState, setPickerState] = useState({ open: false, target: 'create', mode: 'hours', value: 24 });
  const [clockTick, setClockTick] = useState(Date.now());

  const getCsrfHeaders = useCallback(async () => {
    if (csrfToken) return { 'x-csrf-token': csrfToken };
    const response = await fetch('/api/auth/csrf', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    const token = String(data?.csrfToken || '');
    if (token) setCsrfToken(token);
    return token ? { 'x-csrf-token': token } : {};
  }, [csrfToken]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/csrf', { cache: 'no-store' })
      .then((response) => response.json().catch(() => ({})))
      .then((data) => {
        if (!cancelled && data?.csrfToken) setCsrfToken(String(data.csrfToken));
      })
      .catch(() => null);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadStories = async () => {
      try {
        setStoriesLoading(true);
        const params = new URLSearchParams();
        params.set('source', source);
        params.set('limit', '12');
        if (userId) params.set('user_id', userId);
        if (storyId) params.set('story_id', storyId);
        const response = await fetch(`/api/stories?${params.toString()}`, { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!cancelled && response.ok) {
          setStoriesPayload({ items: Array.isArray(data.items) ? data.items : [] });
        }
      } finally {
        if (!cancelled) setStoriesLoading(false);
      }
    };
    loadStories();
    return () => { cancelled = true; };
  }, [source, userId, storyId]);

  useEffect(() => {
    const items = Array.isArray(storiesPayload.items) ? storiesPayload.items : [];
    if (!items.length) {
      setActiveStoryIndex(0);
      return;
    }
    if (storyId) {
      const index = items.findIndex((item) => String(item.id) === String(storyId));
      setActiveStoryIndex(index >= 0 ? index : 0);
      return;
    }
    setActiveStoryIndex((prev) => Math.min(prev, Math.max(0, items.length - 1)));
  }, [storiesPayload.items, storyId]);

  const stories = useMemo(() => (Array.isArray(storiesPayload.items) ? storiesPayload.items : []).filter((item) => isRenderableMoment(item) && item?.is_demo !== true && item?.is_renderable !== false), [storiesPayload.items]);

  useEffect(() => {
    const active = storiesPayload.items?.[activeStoryIndex];
    if (!active || mode !== 'viewer' || !active.id) return;
    getCsrfHeaders().then((headers) => fetch(`/api/stories/${active.id}/seen`, { method: 'POST', headers }).catch(() => null));
  }, [storiesPayload.items, activeStoryIndex, mode, getCsrfHeaders]);

  const effectiveViewerPaused = viewerManualPaused || viewerHoldPaused;

  const closeViewer = useCallback(() => {
    if (holdPauseTimerRef.current) {
      window.clearTimeout(holdPauseTimerRef.current);
      holdPauseTimerRef.current = null;
    }
    setViewerHoldPaused(false);
    setViewerManualPaused(false);
    setViewerUiHidden(false);
    setViewerSwipeOffsetY(0);
    router.back();
  }, [router]);

  const jumpToStoryIndex = useCallback((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= stories.length) return;
    if (holdPauseTimerRef.current) {
      window.clearTimeout(holdPauseTimerRef.current);
      holdPauseTimerRef.current = null;
    }
    setViewerHoldPaused(false);
    setViewerManualPaused(false);
    setViewerUiHidden(false);
    setViewerSwipeOffsetY(0);
    setViewerProgress(0);
    setActiveStoryIndex(index);
  }, [stories.length]);

  const goToPreviousStory = useCallback(() => {
    if (holdPauseTimerRef.current) {
      window.clearTimeout(holdPauseTimerRef.current);
      holdPauseTimerRef.current = null;
    }
    setViewerHoldPaused(false);
    setViewerManualPaused(false);
    setViewerUiHidden(false);
    setViewerSwipeOffsetY(0);
    setViewerProgress(0);
    setActiveStoryIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const goToNextStory = useCallback(() => {
    if (holdPauseTimerRef.current) {
      window.clearTimeout(holdPauseTimerRef.current);
      holdPauseTimerRef.current = null;
    }
    setViewerHoldPaused(false);
    setViewerManualPaused(false);
    setViewerUiHidden(false);
    setViewerSwipeOffsetY(0);
    setViewerProgress(0);
    const lastIndex = Math.max(0, stories.length - 1);
    setActiveStoryIndex((prev) => {
      if (prev >= lastIndex) {
        window.setTimeout(() => closeViewer(), 0);
        return lastIndex;
      }
      return prev + 1;
    });
  }, [closeViewer, stories.length]);

  useEffect(() => {
    if (mode !== 'viewer') return undefined;
    const active = stories[activeStoryIndex];
    if (!active) return undefined;
    const state = progressStateRef.current;
    const storyKey = String(active.id || activeStoryIndex);
    const storyChanged = state.storyId !== storyKey;
    if (storyChanged) {
      state.storyId = storyKey;
      state.startedAt = performance.now();
      state.pauseStartedAt = 0;
      state.pausedMs = 0;
      state.progress = 0;
      setViewerProgress(0);
    }
    const duration = getMomentPlaybackDuration(active);
    let rafId = 0;
    const step = (timestamp) => {
      if (effectiveViewerPaused) {
        if (!state.pauseStartedAt) state.pauseStartedAt = timestamp;
        rafId = window.requestAnimationFrame(step);
        return;
      }
      if (state.pauseStartedAt) {
        state.pausedMs += timestamp - state.pauseStartedAt;
        state.pauseStartedAt = 0;
      }
      const progress = Math.min(1, (timestamp - state.startedAt - state.pausedMs) / duration);
      if (progress !== state.progress) {
        state.progress = progress;
        setViewerProgress(progress);
      }
      if (progress >= 1) {
        goToNextStory();
        return;
      }
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [mode, stories, activeStoryIndex, effectiveViewerPaused, goToNextStory]);

  useEffect(() => {
    if (mode === 'create' && source !== 'feed') {
      router.replace('/feed');
      return;
    }
    if (mode !== 'create') {
      cameraAutoTriggeredRef.current = false;
      return;
    }
    if (cameraAutoTriggeredRef.current) return;
    cameraAutoTriggeredRef.current = true;
    cameraInputRef.current?.click();
  }, [mode, router, source]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (mode !== 'viewer') return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
    };
  }, [mode]);

  const handleViewerHoldStart = useCallback(() => {
    if (holdPauseTimerRef.current) window.clearTimeout(holdPauseTimerRef.current);
    holdPauseTimerRef.current = window.setTimeout(() => {
      setViewerHoldPaused(true);
      setViewerUiHidden(true);
    }, 180);
  }, []);

  const handleViewerHoldEnd = useCallback(() => {
    if (holdPauseTimerRef.current) {
      window.clearTimeout(holdPauseTimerRef.current);
      holdPauseTimerRef.current = null;
    }
    setViewerHoldPaused(false);
    setViewerUiHidden(false);
  }, []);

  useEffect(() => () => {
    if (holdPauseTimerRef.current) window.clearTimeout(holdPauseTimerRef.current);
  }, []);

  const handleViewerTouchStart = useCallback((event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    viewerTouchStateRef.current = { active: true, startX: touch.clientX, startY: touch.clientY, dragging: false };
  }, []);

  const handleViewerTouchMove = useCallback((event) => {
    const touch = event.touches?.[0];
    const state = viewerTouchStateRef.current;
    if (!touch || !state.active) return;
    const deltaY = touch.clientY - state.startY;
    const deltaX = Math.abs(touch.clientX - state.startX);
    if (deltaY <= 0) return;
    if (!state.dragging && deltaY < 18) return;
    if (deltaY <= deltaX * 1.15) return;
    state.dragging = true;
    if (holdPauseTimerRef.current) {
      window.clearTimeout(holdPauseTimerRef.current);
      holdPauseTimerRef.current = null;
    }
    setViewerHoldPaused(true);
    setViewerUiHidden(true);
    setViewerSwipeOffsetY(Math.min(deltaY, 220));
    if (event.cancelable) event.preventDefault();
  }, []);

  const handleViewerTouchEnd = useCallback(() => {
    const state = viewerTouchStateRef.current;
    viewerTouchStateRef.current = { active: false, startX: 0, startY: 0, dragging: false };
    if (!state.dragging) {
      setViewerSwipeOffsetY(0);
      return;
    }
    if (viewerSwipeOffsetY > 110) {
      closeViewer();
      return;
    }
    setViewerSwipeOffsetY(0);
    setViewerHoldPaused(false);
    setViewerUiHidden(false);
  }, [closeViewer, viewerSwipeOffsetY]);

  useEffect(() => {
    if (mode !== 'viewer') return;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeViewer();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToNextStory();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToPreviousStory();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, closeViewer, goToNextStory, goToPreviousStory]);

  const headerName = mode === 'create' ? 'Создать момент' : 'Моменты';
  const activeStory = stories[activeStoryIndex] || null;

  const viewerMeta = useMemo(() => {
    void clockTick;
    if (!activeStory) return { timeLeftLabel: '', extensionsLeft: 0, ownerSummary: null };
    return {
      timeLeftLabel: formatTimeLeftLabel(activeStory.time_left_ms || (activeStory.expires_at ? (new Date(activeStory.expires_at).getTime() - Date.now()) : 0)),
      extensionsLeft: Number(activeStory.extensions_left || 0) || 0,
      ownerSummary: activeStory.is_mine ? {
        views: Number(activeStory.seen_count || 0) || 0,
        replies: Number(activeStory.reply_count || 0) || 0,
        plus: Number(activeStory.plus_count || 0) || 0,
        minus: Number(activeStory.minus_count || 0) || 0,
      } : null,
    };
  }, [activeStory, clockTick]);

  useEffect(() => {
    setViewerHoldPaused(false);
    setViewerUiHidden(false);
    setViewerSwipeOffsetY(0);
  }, [activeStoryIndex, mode]);

  const openDurationPicker = useCallback((target, durationMinutes) => {
    const safe = Number(durationMinutes || DEFAULT_DURATION_MINUTES) || DEFAULT_DURATION_MINUTES;
    const isMinutes = safe < 60;
    setPickerState({
      open: true,
      target,
      mode: isMinutes ? 'minutes' : 'hours',
      value: isMinutes ? safe : Math.max(1, Math.round(safe / 60)),
    });
  }, []);

  const handleUploadMedia = async (file) => {
    if (!(file instanceof File)) return;
    lastUploadFileRef.current = file;
    const kind = file.type.startsWith('video/') ? 'video' : 'image';
    try {
      setUploadState({ loading: true, error: '' });
      const headers = await getCsrfHeaders();
      const form = new FormData();
      form.set('file', file);
      form.set('kind', kind);
      const response = await fetch('/api/stories/media/upload', { method: 'POST', body: form, headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.media?.url) throw new Error(data?.error || 'Не удалось загрузить медиа для момента.');
      setDraft((current) => ({ ...current, media: data.media }));
      setUploadState({ loading: false, error: '' });
    } catch (error) {
      setUploadState({ loading: false, error: error?.message || 'Не удалось загрузить медиа для момента.' });
    }
  };

  const handleRetryUpload = useCallback(() => {
    if (!(lastUploadFileRef.current instanceof File)) return;
    handleUploadMedia(lastUploadFileRef.current);
  }, []);

  const handlePublish = async () => {
    if (!draft.media?.url) return;
    try {
      setPublishing(true);
      setUploadState({ loading: false, error: '' });
      const kind = draft.media.kind === 'video' ? 'video' : 'photo';
      const title = kind === 'video' ? 'Видео момента' : 'Фото момента';
      const headers = { 'Content-Type': 'application/json', ...(await getCsrfHeaders()) };
      const response = await fetch('/api/stories', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind,
          title,
          subtitle: draft.subtitle || '',
          source,
          audience: 'friends',
          preview_url: draft.media.preview_url || draft.media.url || '',
          media_url: draft.media.url || '',
          duration_ms: draft.media.duration_ms || null,
          duration_minutes: draft.durationMinutes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.story?.id) throw new Error(data?.error || 'Не удалось опубликовать момент.');
      setDraft({ subtitle: '', media: null, durationMinutes: DEFAULT_DURATION_MINUTES });
      lastUploadFileRef.current = null;
      router.replace('/feed');
    } catch (error) {
      setUploadState({ loading: false, error: error?.message || 'Не удалось опубликовать момент.' });
      setPublishing(false);
      return;
    }
    setPublishing(false);
  };

  const handleReply = async () => {
    if (!activeStory?.id || activeStory?.is_mine) return;
    try {
      setReplying(true);
      const headers = { 'Content-Type': 'application/json', ...(await getCsrfHeaders()) };
      const response = await fetch(`/api/stories/${activeStory.id}/reply`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: `Ответ на момент: ${activeStory.title || 'момент'}` }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Не удалось ответить на момент.');
      const targetUserId = data?.target_user_id || activeStory?.author?.id;
      const params = new URLSearchParams();
      if (targetUserId) params.set('user', String(targetUserId));
      if (activeStory?.id) params.set('momentId', String(activeStory.id));
      if (activeStory?.title) params.set('momentTitle', String(activeStory.title));
      if (activeStory?.author?.name) params.set('momentAuthor', String(activeStory.author.name));
      router.push(`/chat${params.toString() ? `?${params.toString()}` : ''}`);
    } catch (error) {
      console.error('moment reply handoff failed', error);
    } finally {
      setReplying(false);
    }
  };

  const handleReact = async (reaction) => {
    if (!activeStory?.id || activeStory?.is_mine) return;
    try {
      setReacting(true);
      const headers = { 'Content-Type': 'application/json', ...(await getCsrfHeaders()) };
      const response = await fetch(`/api/stories/${activeStory.id}/reaction`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reaction }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.story?.id) throw new Error(data?.error || 'Не удалось оценить момент.');
      setStoriesPayload((current) => ({
        ...current,
        items: (current.items || []).map((item) => String(item.id) === String(data.story.id) ? { ...item, ...data.story } : item),
      }));
    } catch (error) {
      console.error('moment reaction failed', error);
    } finally {
      setReacting(false);
    }
  };

  const handleExtendMoment = async (durationMinutes) => {
    if (!activeStory?.id) return;
    try {
      setExtending(true);
      setUploadState({ loading: false, error: '' });
      const headers = { 'Content-Type': 'application/json', ...(await getCsrfHeaders()) };
      const response = await fetch(`/api/stories/${activeStory.id}/extend`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ duration_minutes: durationMinutes }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.story?.id) throw new Error(data?.error || 'Не удалось продлить момент.');
      setStoriesPayload((current) => ({
        ...current,
        items: (current.items || []).map((item) => String(item.id) === String(data.story.id) ? { ...item, ...data.story } : item),
      }));
      setPickerState((current) => ({ ...current, open: false }));
    } catch (error) {
      setUploadState({ loading: false, error: error?.message || 'Не удалось продлить момент.' });
    } finally {
      setExtending(false);
    }
  };


  const handleDeleteMoment = async () => {
    if (!activeStory?.id || !activeStory?.is_mine || deleting) return;
    try {
      setDeleting(true);
      const headers = await getCsrfHeaders();
      const response = await fetch(`/api/stories/${activeStory.id}`, { method: 'DELETE', headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Не удалось удалить момент.');
      setStoriesPayload((current) => ({
        ...current,
        items: (current.items || []).filter((item) => String(item.id) !== String(activeStory.id)),
      }));
      const remaining = stories.filter((item) => String(item.id) !== String(activeStory.id));
      if (!remaining.length) {
        router.replace(buildStoriesHref({ source, mode: 'create', title: 'Создать момент' }));
      } else {
        setActiveStoryIndex((prev) => Math.max(0, Math.min(prev, remaining.length - 1)));
      }
    } catch (error) {
      setUploadState({ loading: false, error: error?.message || 'Не удалось удалить момент.' });
    } finally {
      setDeleting(false);
    }
  };

  const handlePickerConfirm = () => {
    const durationMinutes = pickerState.mode === 'minutes' ? pickerState.value : pickerState.value * 60;
    if (pickerState.target === 'extend') {
      handleExtendMoment(durationMinutes);
      return;
    }
    setDraft((current) => ({ ...current, durationMinutes }));
    setPickerState((current) => ({ ...current, open: false }));
  };

  const emptyText = useMemo(() => mode === 'create' ? 'Снимите фото или видео и опубликуйте новый момент.' : 'У друзей пока нет новых моментов.', [mode]);

  return (
    <div className="app-shell">
      <div className={`app profile-app storyHub-app ${mode === 'viewer' ? 'storyHub-appViewer' : ''}`}>
        <main className={`screen storyHub-screen ${mode === 'viewer' ? 'storyHub-screenViewer' : ''}`}>
          {mode === 'viewer' ? null : (
            <header className="storyHub-topbar">
              <button type="button" className="storyHub-back" onClick={() => router.back()}>← Назад</button>
              <div>
                <h1 className="storyHub-title">{headerName}</h1>
                <div className="storyHub-subtitle">Камера, срок жизни и публикация без лишних экранов.</div>
              </div>
            </header>
          )}

          <input ref={cameraInputRef} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(event) => { const file = event.target.files?.[0] || null; if (file) handleUploadMedia(file); event.target.value = ''; }} />
          <input ref={galleryInputRef} type="file" accept="image/*,video/*" hidden onChange={(event) => { const file = event.target.files?.[0] || null; if (file) handleUploadMedia(file); event.target.value = ''; }} />

          {storiesLoading && mode !== 'create' ? (
            <section className="storyHub-composerCard"><div className="storyHub-composerHead"><div><div className="storyHub-badge">Загрузка</div><h2>Загружаем моменты…</h2></div></div></section>
          ) : mode === 'create' ? (
            <Composer
              draft={draft}
              uploadState={uploadState}
              publishing={publishing}
              onCamera={() => cameraInputRef.current?.click()}
              onGallery={() => galleryInputRef.current?.click()}
              onClear={() => { setDraft((current) => ({ ...current, media: null })); setUploadState((current) => ({ ...current, error: '' })); }}
              onPublish={handlePublish}
              onChangeSubtitle={(value) => setDraft((current) => ({ ...current, subtitle: value }))}
              onOpenDurationPicker={() => openDurationPicker('create', draft.durationMinutes)}
              onSelectPreset={(durationMinutes) => setDraft((current) => ({ ...current, durationMinutes }))}
              onRetryUpload={handleRetryUpload}
              onBackToFeed={() => router.push('/feed')}
            />
          ) : stories.length ? (
            <Viewer
              stories={stories}
              activeIndex={activeStoryIndex}
              activeProgress={viewerProgress}
              paused={effectiveViewerPaused}
              uiHidden={viewerUiHidden}
              swipeOffsetY={viewerSwipeOffsetY}
              reacting={reacting}
              deleting={deleting}
              onTogglePause={() => setViewerManualPaused((prev) => !prev)}
              onPrev={goToPreviousStory}
              onNext={goToNextStory}
              onJumpToIndex={jumpToStoryIndex}
              onClose={closeViewer}
              onReply={handleReply}
              replying={replying}
              onReact={handleReact}
              onDelete={handleDeleteMoment}
              onOpenExtend={() => openDurationPicker('extend', activeStory?.duration_minutes || DEFAULT_DURATION_MINUTES)}
              extending={extending}
              timeLeftLabel={viewerMeta.timeLeftLabel}
              extensionsLeft={viewerMeta.extensionsLeft}
              ownerSummary={viewerMeta.ownerSummary}
              onHoldStart={handleViewerHoldStart}
              onHoldEnd={handleViewerHoldEnd}
              onTouchStart={handleViewerTouchStart}
              onTouchMove={handleViewerTouchMove}
              onTouchEnd={handleViewerTouchEnd}
              onTouchCancel={handleViewerTouchEnd}
            />
          ) : (
            <section className="storyHub-composerCard">
              <div className="storyHub-composerHead">
                <div>
                  <div className="storyHub-badge">Моменты</div>
                  <h2>Пока пусто</h2>
                  <p>{emptyText}</p>
                </div>
              </div>
              <div className="storyHub-ctaRow">
                {source === 'feed' ? <button type="button" className="storyHub-primary" onClick={() => router.push(buildStoriesHref({ source: 'feed', mode: 'create', title: 'Создать момент' }))}>Создать момент</button> : <button type="button" className="storyHub-primary" onClick={() => router.push('/feed')}>В ленту</button>}
              </div>
            </section>
          )}
        </main>
        <DurationPicker
          open={pickerState.open}
          mode={pickerState.mode}
          value={pickerState.value}
          busy={extending}
          onSelectMode={(nextMode) => setPickerState((current) => ({ ...current, mode: nextMode, value: nextMode === 'minutes' ? Math.max(10, Math.min(59, current.value)) : Math.max(1, Math.min(48, current.value)) }))}
          onChangeValue={(nextValue) => setPickerState((current) => ({ ...current, value: nextValue }))}
          onClose={() => setPickerState((current) => ({ ...current, open: false }))}
          onConfirm={handlePickerConfirm}
        />
      </div>
    </div>
  );
}

'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PostAuthBottomNav from '@/components/PostAuthBottomNav';
import { MinimalActionDialog, useMinimalActionDialog } from '@/components/MinimalActionDialog';
import ProfileMediaAlbum from '@/components/ProfileMediaAlbum';
import ProfilePostCardRich from '@/components/profile/ProfilePostCardRich';
import PostShareSheet from '@/components/PostShareSheet';
import { readPageCache, writePageCache } from '@/lib/page-cache';
import { COMMUNITIES_UI_ENABLED } from '@/lib/product-flags';

const PROFILE_CACHE_KEY = 'page:profile';
const PROFILE_CACHE_TTL = 3 * 60 * 1000;
const POST_TEXT_LIMIT = 1000;

const toneOptions = [
  { value: 'violet', label: 'Фиолетовый' },
  { value: 'mint', label: 'Мятный' },
  { value: 'blue', label: 'Синий' },
  { value: 'gold', label: 'Золотой' },
  { value: 'rose', label: 'Розовый' },
  { value: 'slate', label: 'Графит' },
];

const cityOptions = [
  'Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск', 'Нижний Новгород',
  'Минск', 'Киев', 'Алматы', 'Астана', 'Тбилиси', 'Ереван', 'Баку',
  'Вильнюс', 'Рига', 'Таллин', 'Варшава', 'Берлин', 'Прага', 'Лондон', 'Париж', 'Барселона',
  'Стамбул', 'Дубай', 'Тель-Авив', 'Нью-Йорк', 'Лос-Анджелес', 'Торонто', 'Другое',
];

const relationshipOptions = ['Не указывать', 'Не в отношениях', 'В отношениях', 'В браке', 'Всё сложно'];
const worldviewOptions = ['Не указывать', 'Открыт(а) к новому', 'Семья', 'Творчество', 'Карьера', 'Учёба', 'Путешествия', 'Спокойная жизнь'];
const militaryServiceOptions = ['Не указывать', 'Не служил(а)', 'Служил(а)', 'Военнообязанный(ая)', 'В запасе'];
const languageOptions = [
  'Русский', 'Английский', 'Белорусский', 'Украинский', 'Казахский', 'Армянский', 'Грузинский', 'Азербайджанский',
  'Немецкий', 'Французский', 'Испанский', 'Итальянский', 'Португальский', 'Польский', 'Чешский',
  'Литовский', 'Латышский', 'Эстонский', 'Турецкий', 'Арабский', 'Китайский', 'Японский', 'Корейский', 'Хинди',
];

const EMPTY_SELECT_LABEL = 'Не указывать';
const LEGACY_EMPTY_SELECT_LABEL = 'Не хочу указывать';

function normalizeSelectValue(value) {
  const current = String(value || '').trim();
  if (!current || current === EMPTY_SELECT_LABEL || current === LEGACY_EMPTY_SELECT_LABEL) return '';
  return current;
}

function EditIcon() {
  return <svg viewBox="0 0 24 24"><path d="m4 20 4.5-1 9.9-9.9a2.12 2.12 0 0 0-3-3L5.5 16 4 20z"></path><path d="m13.5 6.5 4 4"></path></svg>;
}

function AttachIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 12.5 15 6a3.2 3.2 0 1 1 4.5 4.5l-8.4 8.4a5 5 0 0 1-7.1-7.1L12.2 3.6"></path></svg>;
}

function SendIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 4 10 15"></path><path d="m21 4-7 16-4-6-6-4 17-6Z"></path></svg>;
}

function normalizeEditorInterests(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

function normalizeEditorLanguages(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const result = [];
  for (const item of source) {
    const text = String(item || '').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function normalizeEditorPersonalDetails(profile) {
  const details = profile?.personal_details && typeof profile.personal_details === 'object' ? profile.personal_details : {};
  return {
    hometown: details.hometown || '',
    birth_date: details.birth_date || '',
    workplace: details.workplace || '',
    school: details.school || '',
    education: details.education || '',
    military_service: normalizeSelectValue(details.military_service),
    languages: normalizeEditorLanguages(details.languages),
    website: details.website || '',
    worldview: normalizeSelectValue(details.worldview),
    quote: details.quote || '',
  };
}

function withCurrentOption(options, value) {
  const current = String(value || '').trim();
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}

function createEditableState(profile) {
  return {
    handle: profile?.handle_raw || '',
    bio: profile?.bio || '',
    occupation: profile?.occupation || '',
    city: normalizeSelectValue(profile?.city),
    relationship_status: normalizeSelectValue(profile?.relationship_status),
    tone: profile?.tone || 'violet',
    cover_tone: profile?.cover_tone || profile?.tone || 'violet',
    avatar_url: profile?.avatar_url || '',
    cover_url: profile?.cover_url || '',
    interests: normalizeEditorInterests(profile?.interests),
    personal_details: normalizeEditorPersonalDetails(profile),
  };
}

function ProfileTabButton({ active, children, onClick }) {
  return (
    <button type="button" className={`profileClean-tab ${active ? 'is-active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function ProfileInlineComposer({
  value,
  media = [],
  uploadBusy,
  publishBusy,
  onChange,
  onFiles,
  onRemoveMedia,
  onSubmit,
}) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [supportsDragDrop, setSupportsDragDrop] = useState(false);
  const canSubmit = Boolean(value.trim() || media.length) && !uploadBusy && !publishBusy;

  useLayoutEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = 'auto';
    const nextHeight = Math.min(Math.max(field.scrollHeight, 42), 132);
    field.style.height = `${nextHeight}px`;
    field.style.overflowY = field.scrollHeight > 132 ? 'auto' : 'hidden';
  }, [value]);

  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const syncDragSupport = () => setSupportsDragDrop(query.matches);
    syncDragSupport();

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', syncDragSupport);
      return () => query.removeEventListener('change', syncDragSupport);
    }

    query.addListener(syncDragSupport);
    return () => query.removeListener(syncDragSupport);
  }, []);

  useEffect(() => {
    if (!attachOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setAttachOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [attachOpen]);

  const handleFiles = (files) => {
    const picked = Array.from(files || []);
    if (!picked.length) return;
    onFiles(picked);
    setAttachOpen(false);
    setDragActive(false);
  };

  return (
    <section className={`profileComposer profileComposer-minimal ${attachOpen ? 'is-choosing' : ''}`} aria-label="Новая публикация">
      <div className="profileComposer-line">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value.slice(0, POST_TEXT_LIMIT))}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              if (canSubmit) onSubmit();
            }
          }}
          rows={1}
          placeholder="Что нового?"
          aria-label="Текст публикации"
          maxLength={POST_TEXT_LIMIT}
        />

        <button
          type="button"
          className={`profileComposer-iconBtn is-attach ${uploadBusy ? 'is-busy' : ''}`}
          disabled={uploadBusy || publishBusy}
          onClick={() => setAttachOpen((prev) => !prev)}
          aria-expanded={attachOpen}
          aria-label="Прикрепить файл"
        >
          <AttachIcon />
        </button>

        <button type="button" className="profileComposer-iconBtn is-send" disabled={!canSubmit} onClick={onSubmit} aria-label="Отправить публикацию">
          <SendIcon />
        </button>
      </div>

      {attachOpen ? (
        <div className={`profileComposer-attachPanel ${supportsDragDrop ? 'is-dragdrop' : 'is-mobile'}`} role="dialog" aria-label="Прикрепить медиа">
          {supportsDragDrop ? (
            <div
              className={`profileComposer-dropZone ${dragActive ? 'is-dragover' : ''}`}
              onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
              onDrop={(event) => { event.preventDefault(); handleFiles(event.dataTransfer.files); }}
            >
              <span className="profileComposer-dropIcon"><AttachIcon /></span>
              <strong>Перетащите сюда фото или видео</strong>
              <span>До 10 вложений в одной публикации</span>
            </div>
          ) : null}
          <div className="profileComposer-attachActions">
            <button type="button" className="profileComposer-attachChoice" onClick={() => fileInputRef.current?.click()}>
              Выбрать на устройстве
            </button>
            <button type="button" className="profileComposer-attachCancel" onClick={() => setAttachOpen(false)}>
              Отмена
            </button>
          </div>
          <input
            ref={fileInputRef}
            className="profileComposer-hiddenInput"
            type="file"
            accept="image/*,video/*"
            multiple
            disabled={uploadBusy || publishBusy}
            onChange={(event) => { handleFiles(event.target.files); event.target.value = ''; }}
          />
        </div>
      ) : null}

      <div className="profileComposer-counter">{value.length}/{POST_TEXT_LIMIT}</div>

      {media.length ? (
        <div className="profileComposer-attachments" aria-label="Прикреплённые файлы">
          {media.map((item, index) => {
            const previewUrl = item.thumbUrl || item.url || '';
            const isVideo = item.kind === 'video';
            const title = item.originalName || (isVideo ? `Видео ${index + 1}` : `Фото ${index + 1}`);
            return (
              <button key={`${previewUrl}-${index}`} type="button" className="profileComposer-attachmentChip" onClick={() => onRemoveMedia(index)} title="Убрать файл">
                <span className={`profileComposer-attachmentThumb ${isVideo ? 'is-video' : ''}`} aria-hidden="true">
                  {previewUrl ? <img src={previewUrl} alt="" /> : <b>{isVideo ? 'В' : 'Ф'}</b>}
                </span>
                <span className="profileComposer-attachmentMeta">
                  <span>{isVideo ? 'Видео' : 'Фото'}</span>
                  <strong>{title}</strong>
                </span>
                <i aria-hidden="true">×</i>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function ProfilePostsEmptyState() {
  return (
    <section className="profileClean-postsEmpty" aria-label="Пустой список публикаций">
      <div className="profileClean-postsEmptyArt" aria-hidden="true">
        <span className="profileClean-postsEmptyGlow" />
        <span className="profileClean-postsEmptyCard is-back" />
        <span className="profileClean-postsEmptyCard is-front"><span /><span /><span /></span>
        <span className="profileClean-postsEmptyPlus">•</span>
      </div>
      <div className="profileClean-postsEmptyBody">
        <span className="profileClean-postsEmptyBadge">Профиль пока чистый</span>
        <strong className="profileClean-postsEmptyTitle">Публикаций ещё нет</strong>
        <p className="profileClean-postsEmptyText">Когда появится первый пост, он аккуратно встанет здесь отдельной карточкой.</p>
      </div>
    </section>
  );
}
function profileAssetStyle(url) {
  const safe = String(url || '').trim().replace(/"/g, '%22');
  if (!safe) return undefined;
  return { backgroundImage: `linear-gradient(180deg, rgba(17,17,19,.05), rgba(17,17,19,.28)), url("${safe}")` };
}

function ProfileAssetPicker({ label, hint, field, value, tone, busy, onFile, onClear, children }) {
  const isBusy = busy === field;
  return (
    <div className="profileEdit-assetPicker">
      <div className="profileEdit-assetPreview">{children}</div>
      <div className="profileEdit-assetMeta">
        <strong>{label}</strong>
        {hint ? <span>{hint}</span> : null}
        <div className="profileEdit-assetActions">
          <label className="profileClean-ghostBtn is-small">
            {isBusy ? 'Загружаем…' : value ? 'Заменить' : 'Загрузить'}
            <input type="file" accept="image/*" disabled={Boolean(busy)} onChange={(event) => { onFile(field, event.target.files?.[0]); event.target.value = ''; }} />
          </label>
          {value ? <button type="button" className="profileClean-ghostBtn is-small" disabled={Boolean(busy)} onClick={() => onClear(field)}>Убрать</button> : null}
        </div>
      </div>
    </div>
  );
}

function ProfileInterestEditor({ value = [], onChange }) {
  const [draft, setDraft] = useState('');
  const interests = normalizeEditorInterests(value);
  const addInterest = () => {
    const next = draft.trim().slice(0, 28);
    if (!next) return;
    if (interests.some((item) => item.toLowerCase() === next.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...interests, next].slice(0, 8));
    setDraft('');
  };
  return (
    <div className="profileEdit-interestEditor">
      <div className="profileEdit-interestRow">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addInterest(); } }} placeholder="Например: дизайн, музыка, бег" maxLength={28} />
        <button type="button" className="profileClean-ghostBtn" onClick={addInterest} disabled={!draft.trim() || interests.length >= 8}>Добавить</button>
      </div>
      <div className="profileEdit-interestChips">
        {interests.length ? interests.map((item) => (
          <button key={item} type="button" onClick={() => onChange(interests.filter((current) => current !== item))}>{item}<span>×</span></button>
        )) : <span>Интересы помогут профилю выглядеть живее.</span>}
      </div>
    </div>
  );
}

function ProfileSelectField({ label, value, options, onChange, placeholder = 'Не указывать' }) {
  const normalizedValue = normalizeSelectValue(value);
  const baseOptions = options.filter((item) => item !== placeholder && item !== EMPTY_SELECT_LABEL);
  const allOptions = withCurrentOption(baseOptions, normalizedValue);
  return (
    <label className="profileClean-field">
      <span>{label}</span>
      <select value={normalizedValue} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {allOptions.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  );
}

function ProfileAutoTextareaField({ label, value, onChange, placeholder, maxLength, rows = 1 }) {
  const fieldRef = useRef(null);
  const resize = () => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    resize();
  }, [value]);

  return (
    <label className="profileClean-field profileEdit-autoField">
      <span>{label}</span>
      <textarea
        ref={fieldRef}
        value={value || ''}
        onChange={(event) => {
          onChange(event.target.value);
          requestAnimationFrame(resize);
        }}
        onInput={resize}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
      />
    </label>
  );
}

function ProfileLanguageMultiSelect({ value = [], onChange }) {
  const languages = normalizeEditorLanguages(value);
  const options = languageOptions.filter((item) => !languages.some((current) => current.toLowerCase() === item.toLowerCase()));
  const addLanguage = (language) => {
    const next = String(language || '').trim();
    if (!next) return;
    if (languages.some((item) => item.toLowerCase() === next.toLowerCase())) return;
    onChange([...languages, next]);
  };

  return (
    <div className="profileEdit-languagePicker">
      <select value="" onChange={(event) => addLanguage(event.target.value)}>
        <option value="">Добавить язык</option>
        {options.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <div className="profileEdit-interestChips profileEdit-languageChips">
        {languages.length ? languages.map((item) => (
          <button key={item} type="button" onClick={() => onChange(languages.filter((current) => current !== item))}>{item}<span>×</span></button>
        )) : <span>Выберите все языки, которыми владеете. Ограничения по количеству нет.</span>}
      </div>
    </div>
  );
}
function ProfileEditScreen({
  editor,
  firstLetter,
  fullName,
  profile,
  profileError,
  savingProfile,
  assetUploadBusy,
  onCancel,
  onChange,
  onAssetFile,
  onAssetClear,
  onSubmit,
}) {
  const handle = editor.handle ? `@${editor.handle}` : (profile.handle_raw ? `@${profile.handle_raw}` : '@profile');
  const coverTone = editor.cover_tone || editor.tone || profile.cover_tone || profile.tone || 'violet';
  const avatarTone = editor.tone || profile.tone || 'violet';
  const coverStyle = profileAssetStyle(editor.cover_url);
  const personalDetails = editor.personal_details || normalizeEditorPersonalDetails(null);
  const updatePersonalDetails = (patch) => onChange((prev) => ({
    ...prev,
    personal_details: { ...(prev.personal_details || {}), ...patch },
  }));

  return (
    <div className="app-shell">
      <div className="app profile-app">
        <main className="screen profileEdit-screen">
          <header className="profileEdit-topbar">
            <button type="button" className="profileClean-backBtn profileEdit-backBtn" onClick={onCancel} aria-label="Вернуться в профиль">←</button>
            <div className="profileEdit-titleBlock">
              <div className="profileEdit-title">Редактирование</div>
            </div>
            <button type="submit" form="profile-edit-form" className="profileClean-primaryBtn profileEdit-saveBtn" disabled={savingProfile || Boolean(assetUploadBusy)}>{savingProfile ? 'Сохраняем…' : 'Сохранить'}</button>
          </header>

          {profileError ? <div className="profileClean-alert is-error">{profileError}</div> : null}

          <section className="profileEdit-previewHero">
            <div className={`profileEdit-previewCover is-${coverTone}`} style={coverStyle} />
            <div className="profileEdit-previewMain">
              <div className={`profileClean-avatar profileEdit-avatar is-${avatarTone}`}>{editor.avatar_url ? <img src={editor.avatar_url} alt="" /> : firstLetter}</div>
              <div className="profileEdit-previewText">
                <span>Так профиль увидят другие</span>
                <strong>{fullName}</strong>
                <p>{handle}</p>
              </div>
            </div>
          </section>

          <form id="profile-edit-form" className="profileEdit-form" onSubmit={onSubmit}>
            <section className="profileClean-card profileClean-panel profileEdit-panel">
              <div className="profileClean-sectionHead">
                <div>
                  <h2 className="profileClean-sectionTitle">Аватар и обложка</h2>
                </div>
              </div>

              <div className="profileEdit-assetGrid">
                <ProfileAssetPicker label="Аватар" field="avatar_url" value={editor.avatar_url} busy={assetUploadBusy} onFile={onAssetFile} onClear={onAssetClear}>
                  <div className={`profileEdit-assetAvatar is-${avatarTone}`}>{editor.avatar_url ? <img src={editor.avatar_url} alt="" /> : firstLetter}</div>
                </ProfileAssetPicker>
                <ProfileAssetPicker label="Обложка" field="cover_url" value={editor.cover_url} busy={assetUploadBusy} onFile={onAssetFile} onClear={onAssetClear}>
                  <div className={`profileEdit-assetCover is-${coverTone}`} style={coverStyle} />
                </ProfileAssetPicker>
              </div>

              <div className="profileClean-formGrid">
                <label className="profileClean-field">
                  <span>Цвет аватара</span>
                  <select value={editor.tone} onChange={(event) => onChange((prev) => ({ ...prev, tone: event.target.value }))}>
                    {toneOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="profileClean-field">
                  <span>Цвет обложки</span>
                  <select value={editor.cover_tone} onChange={(event) => onChange((prev) => ({ ...prev, cover_tone: event.target.value }))}>
                    {toneOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
              </div>
            </section>

            <section className="profileClean-card profileClean-panel profileEdit-panel">
              <div className="profileClean-sectionHead">
                <div>
                  <h2 className="profileClean-sectionTitle">Основное</h2>
                </div>
              </div>

              <label className="profileClean-field">
                <span>Адрес профиля</span>
                <input value={editor.handle} onChange={(event) => onChange((prev) => ({ ...prev, handle: event.target.value.replace(/^@+/, '') }))} placeholder="ivan.anoshin" maxLength={24} />
              </label>

              <label className="profileClean-field">
                <span>Описание</span>
                <textarea value={editor.bio} onChange={(event) => onChange((prev) => ({ ...prev, bio: event.target.value }))} placeholder="Коротко расскажи о себе" maxLength={240} rows={4} />
              </label>

              <label className="profileClean-field">
                <span>Интересы</span>
                <ProfileInterestEditor value={editor.interests} onChange={(interests) => onChange((prev) => ({ ...prev, interests }))} />
              </label>
            </section>

            <section className="profileClean-card profileClean-panel profileEdit-panel">
              <div className="profileClean-sectionHead">
                <div>
                  <h2 className="profileClean-sectionTitle">Личная информация</h2>
                  <p className="profileClean-sectionText">Поля можно оставить пустыми. Там, где выбор очевидный, используем списки вместо ручного ввода.</p>
                </div>
              </div>

              <div className="profileEdit-personalFields">
                <ProfileSelectField label="Город сейчас" value={editor.city} options={cityOptions} onChange={(city) => onChange((prev) => ({ ...prev, city }))} />
                <ProfileSelectField label="Родной город" value={personalDetails.hometown} options={cityOptions} onChange={(hometown) => updatePersonalDetails({ hometown })} />
                <ProfileAutoTextareaField label="Занятие" value={editor.occupation} onChange={(occupation) => onChange((prev) => ({ ...prev, occupation }))} maxLength={80} />
                <ProfileAutoTextareaField label="Место работы / проект" value={personalDetails.workplace} onChange={(workplace) => updatePersonalDetails({ workplace })} maxLength={100} />
                <ProfileAutoTextareaField label="Школа" value={personalDetails.school} onChange={(school) => updatePersonalDetails({ school })} maxLength={100} />
                <ProfileAutoTextareaField label="Образование" value={personalDetails.education} onChange={(education) => updatePersonalDetails({ education })} maxLength={100} />
                <ProfileSelectField label="Военная служба" value={personalDetails.military_service} options={militaryServiceOptions} onChange={(military_service) => updatePersonalDetails({ military_service })} />
                <label className="profileClean-field">
                  <span>Дата рождения</span>
                  <input type="date" value={personalDetails.birth_date} onChange={(event) => updatePersonalDetails({ birth_date: event.target.value })} />
                </label>
                <ProfileSelectField label="Жизненная позиция" value={personalDetails.worldview} options={worldviewOptions} onChange={(worldview) => updatePersonalDetails({ worldview })} />
                <ProfileSelectField label="Статус отношений" value={editor.relationship_status} options={relationshipOptions} onChange={(relationship_status) => onChange((prev) => ({ ...prev, relationship_status }))} />

                <label className="profileClean-field">
                  <span>Языки</span>
                  <ProfileLanguageMultiSelect value={personalDetails.languages} onChange={(languages) => updatePersonalDetails({ languages })} />
                </label>

                <ProfileAutoTextareaField label="Сайт / портфолио" value={personalDetails.website} onChange={(website) => updatePersonalDetails({ website })} placeholder="https://example.com" maxLength={160} />
                <ProfileAutoTextareaField label="Любимая цитата" value={personalDetails.quote} onChange={(quote) => updatePersonalDetails({ quote })} placeholder="Короткая фраза, которая вас описывает" maxLength={180} rows={2} />
              </div>

              {/* legacy class keeps spacing consistent with old form layout */}
              <div className="profileEdit-fieldNote">
                Город, обращение, военная служба, языки и статус отношений выбираются списками. Языков можно отметить сколько угодно.
              </div>
            </section>

            <div className="profileEdit-bottomActions">
              <button type="button" className="profileClean-ghostBtn" onClick={onCancel}>Отмена</button>
              <button type="submit" className="profileClean-primaryBtn" disabled={savingProfile || Boolean(assetUploadBusy)}>{savingProfile ? 'Сохраняем…' : 'Сохранить'}</button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}


function ProfileCommunitiesCard({ items = [], hidden = false, loading = false, onOpen }) {
  return (
    <section className="profileClean-card profileClean-panel profileCommunities-card">
      <div className="profileClean-sectionHead">
        <div>
          <h2 className="profileClean-sectionTitle">Сообщества</h2>
          <p className="profileClean-sectionText">Места, где человек участвует в обсуждениях и публикует материалы.</p>
        </div>
      </div>
      {loading ? <div className="profileClean-emptyState">Загружаем сообщества…</div> : null}
      {!loading && hidden ? <div className="profileClean-emptyState">Список сообществ скрыт настройками приватности.</div> : null}
      {!loading && !hidden && !items.length ? <div className="profileClean-emptyState">Сообществ пока нет.</div> : null}
      {!loading && !hidden && items.length ? (
        <div className="profileCommunities-list">
          {items.slice(0, 8).map((item) => (
            <button key={item.id} type="button" onClick={() => onOpen?.(item.slug)}>
              <strong>{item.name}</strong>
              <span>{item.member_count} участников · {item.member_role ? roleLabelProfileCommunity(item.member_role) : 'участник'}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}


function communityInitials(name) {
  const parts = String(name || 'FS').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'F') + (parts[1]?.[0] || parts[0]?.[1] || 'S');
}

function ProfileCommunitiesListScreen({ items = [], hidden = false, loading = false, onBack, onOpen, title = 'Сообщества' }) {
  return (
    <div className="app-shell">
      <div className="app profile-app">
        <main className="screen profileClean-screen">
          <section className="profileClean-card profileClean-panel">
            <div className="profileClean-sectionHead">
              <button type="button" className="profileClean-backBtn" onClick={onBack}>← Назад</button>
              <h2 className="profileClean-sectionTitle">{title}</h2>
            </div>

            {loading ? <div className="profileClean-emptyState">Загрузка списка…</div> : null}
            {!loading && hidden ? <div className="profileClean-emptyState">Список сообществ скрыт настройками приватности.</div> : null}
            {!loading && !hidden && items.length ? (
              <div className="profileClean-linksList">
                {items.map((item) => (
                  <button key={item.id || item.slug} type="button" className="profileClean-linkRow" onClick={() => onOpen?.(item.slug)}>
                    <div className={`profileClean-miniAvatar is-${item.avatar_tone || 'violet'}`}>{communityInitials(item.name).toUpperCase()}</div>
                    <div className="profileClean-linkText">
                      <strong>{item.name}</strong>
                      <span>{item.member_count || 0} участников · {item.member_role ? roleLabelProfileCommunity(item.member_role) : 'участник'}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            {!loading && !hidden && !items.length ? <div className="profileClean-emptyState">Сообществ пока нет.</div> : null}
          </section>
        </main>
        <PostAuthBottomNav />
      </div>
    </div>
  );
}

function roleLabelProfileCommunity(role) {
  if (role === 'owner') return 'владелец';
  if (role === 'admin') return 'админ';
  if (role === 'moderator') return 'модератор';
  return 'участник';
}

export default function ProfilePage() {
  const actionDialog = useMinimalActionDialog();
  const router = useRouter();
  const initialCacheRef = useRef(null);
  const [activeTab, setActiveTab] = useState('posts');
  const [profile, setProfile] = useState({
    first_name: 'Имя',
    last_name: 'Фамилия',
    id: null,
    handle_raw: '',
    bio: '',
    occupation: '',
    city: '',
    relationship_status: '',
    personal_details: normalizeEditorPersonalDetails(null),
    tone: 'violet',
    friendsCount: 0,
    followersCount: 0,
    subscriptionsCount: 0,
  });
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [editor, setEditor] = useState(createEditableState(null));
  const [assetUploadBusy, setAssetUploadBusy] = useState('');
  const [connectionsKind, setConnectionsKind] = useState('friends');
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [communitiesOpen, setCommunitiesOpen] = useState(false);
  const [connections, setConnections] = useState({ title: 'Друзья', items: [], count: 0 });
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [profilePosts, setProfilePosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState('');
  const [composerText, setComposerText] = useState('');
  const [composerMedia, setComposerMedia] = useState([]);
  const [composerUploadBusy, setComposerUploadBusy] = useState(false);
  const [publishingPost, setPublishingPost] = useState(false);
  const [actionBusyKey, setActionBusyKey] = useState('');
  const [shareSheetPost, setShareSheetPost] = useState(null);
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaCounts, setMediaCounts] = useState({ all: 0, photos: 0, videos: 0, cards: 0 });
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaError, setMediaError] = useState('');
  const [mediaSaving, setMediaSaving] = useState(false);
  const [mediaSettings, setMediaSettings] = useState({ default_filter: 'all', grid_mode: 'comfortable', show_cards: true });
  const [profileCommunities, setProfileCommunities] = useState([]);
  const [communitiesLoading, setCommunitiesLoading] = useState(true);
  const [communitiesHidden, setCommunitiesHidden] = useState(false);

  useLayoutEffect(() => {
    const cachedState = readPageCache(PROFILE_CACHE_KEY, PROFILE_CACHE_TTL);
    initialCacheRef.current = cachedState;
    if (!cachedState) return;
    setActiveTab(cachedState.activeTab === 'communities' ? 'posts' : (cachedState.activeTab || 'posts'));
    if (cachedState.profile) {
      setProfile((prev) => ({ ...prev, ...cachedState.profile }));
      setEditor(createEditableState(cachedState.profile));
      setProfileLoading(false);
    }
    setProfileMessage(cachedState.profileMessage || '');
    if (cachedState.connections) {
      setConnections(cachedState.connections);
      setConnectionsLoading(false);
    }
    setProfilePosts(Array.isArray(cachedState.profilePosts) ? cachedState.profilePosts : []);
    setPostsLoading(!cachedState.profilePosts);
    setMediaItems(Array.isArray(cachedState.mediaItems) ? cachedState.mediaItems : []);
    setMediaCounts(cachedState.mediaCounts || { all: 0, photos: 0, videos: 0, cards: 0 });
    setMediaLoading(!cachedState.mediaItems);
    setMediaSettings(cachedState.mediaSettings || { default_filter: 'all', grid_mode: 'comfortable', show_cards: true });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      try {
        if (!initialCacheRef.current?.profile) setProfileLoading(true);
        setProfileError('');

        const [sessionRes, profileRes] = await Promise.all([
          fetch('/api/auth/session', { cache: 'no-store' }),
          fetch('/api/profile', { cache: 'no-store' }),
        ]);

        if (sessionRes.status === 401 || profileRes.status === 401) {
          window.location.href = '/';
          return;
        }

        const sessionData = await sessionRes.json();
        const profileData = await profileRes.json();

        if (!sessionRes.ok) throw new Error(sessionData.error || 'Не удалось получить сессию.');
        if (!profileRes.ok) throw new Error(profileData.error || 'Не удалось получить профиль.');

        const userId = sessionData.user?.id || profileData.profile?.id || null;
        const userResponse = userId ? await fetch(`/api/users/${userId}`, { cache: 'no-store' }) : null;
        const userData = userResponse ? await userResponse.json() : null;

        const nextProfile = {
          ...profileData.profile,
          id: profileData.profile?.id || userId,
          first_name: profileData.profile?.first_name || sessionData.user?.first_name || 'Имя',
          last_name: profileData.profile?.last_name || sessionData.user?.last_name || 'Фамилия',
          friendsCount: userResponse?.ok ? userData.profile?.friendsCount || 0 : 0,
          followersCount: userResponse?.ok ? userData.profile?.followersCount || 0 : 0,
          subscriptionsCount: userResponse?.ok ? userData.profile?.subscriptionsCount || 0 : 0,
        };

        if (!cancelled) {
          setProfile((prev) => ({ ...prev, ...nextProfile }));
          setEditor(createEditableState(nextProfile));
          sessionStorage.setItem('fs_profile', JSON.stringify(nextProfile));
          if (COMMUNITIES_UI_ENABLED) loadProfileCommunities(nextProfile.id);
        }
      } catch (error) {
        console.warn('profile load fallback enabled', error?.message || error);
        if (!cancelled) setProfileError('');
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    };

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadProfileMedia = async () => {
    try {
      if (!initialCacheRef.current?.mediaItems) setMediaLoading(true);
      setMediaError('');
      const response = await fetch('/api/profile/media', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить альбом.');
      setMediaItems(data.items || []);
      setMediaCounts(data.counts || { all: 0, photos: 0, videos: 0, cards: 0 });
      setMediaSettings(data.settings || { default_filter: 'all', grid_mode: 'comfortable', show_cards: true });
    } catch (error) {
      console.warn('profile media fallback enabled', error?.message || error);
      setMediaError('');
      setMediaItems([]);
      setMediaCounts({ all: 0, photos: 0, videos: 0, cards: 0 });
    } finally {
      setMediaLoading(false);
    }
  };


  const loadProfileCommunities = async (targetUserId) => {
    if (!COMMUNITIES_UI_ENABLED || !targetUserId) {
      setProfileCommunities([]);
      setCommunitiesHidden(false);
      setCommunitiesLoading(false);
      return;
    }
    try {
      setCommunitiesLoading(true);
      const response = await fetch(`/api/users/${targetUserId}/communities?limit=50`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setProfileCommunities(data.communities || []);
        setCommunitiesHidden(data.visible === false);
      } else {
        setProfileCommunities([]);
        setCommunitiesHidden(false);
      }
    } catch {
      setProfileCommunities([]);
    } finally {
      setCommunitiesLoading(false);
    }
  };

  const saveMediaSettings = async (patch) => {
    const next = { ...mediaSettings, ...patch };
    setMediaSettings(next);
    try {
      setMediaSaving(true);
      const response = await fetch('/api/profile/media/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить настройки альбома.');
      setMediaSettings(data.settings || next);
    } catch (error) {
      setMediaError(error.message || 'Не удалось сохранить настройки альбома.');
    } finally {
      setMediaSaving(false);
    }
  };

  const loadProfilePosts = async () => {
    try {
      if (!initialCacheRef.current?.profilePosts) setPostsLoading(true);
      setPostsError('');
      const response = await fetch('/api/profile/posts', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить посты профиля.');
      setProfilePosts(data.posts || []);
    } catch (error) {
      console.warn('profile posts fallback enabled', error?.message || error);
      setPostsError('');
      setProfilePosts([]);
    } finally {
      setPostsLoading(false);
    }
  };

  useEffect(() => {
    loadProfilePosts();
    loadProfileMedia();
  }, []);

  useEffect(() => {
    if (!profile.id && !profilePosts.length && !mediaItems.length && profileLoading) return;
    writePageCache(PROFILE_CACHE_KEY, {
      activeTab,
      profile,
      profileMessage,
      profilePosts,
      mediaItems,
      mediaCounts,
      mediaSettings,
      connections,
    });
  }, [activeTab, profile, profileMessage, profilePosts, mediaItems, mediaCounts, mediaSettings, connections, profileLoading]);

  useEffect(() => {
    let cancelled = false;

    const loadConnections = async () => {
      if (!profile.id || !connectionsOpen) return;
      try {
        setConnectionsLoading(true);
        const response = await fetch(`/api/users/${profile.id}/connections?kind=${connectionsKind}`, { cache: 'no-store' });
        const data = await response.json();
        if (response.ok && !cancelled) setConnections(data);
      } catch {
      } finally {
        if (!cancelled) setConnectionsLoading(false);
      }
    };

    loadConnections();
    return () => {
      cancelled = true;
    };
  }, [profile.id, connectionsKind, connectionsOpen]);

  const firstName = profile.first_name || 'Имя';
  const lastName = profile.last_name || 'Фамилия';
  const fullName = `${firstName} ${lastName}`.trim();
  const firstLetter = firstName.charAt(0).toUpperCase() || 'F';
  const description = profile.bio || 'Здесь будет короткое описание человека, а не каша из кнопок и системных блоков.';
  const headline = [profile.occupation, profile.city].filter(Boolean).join(' · ');

  const aboutItems = useMemo(() => {
    const details = profile.personal_details || {};
    const languages = normalizeEditorLanguages(details.languages);
    return [
      { label: 'Адрес профиля', value: profile.handle_raw ? `@${profile.handle_raw}` : 'Будет создан автоматически' },
      { label: 'Город сейчас', value: profile.city },
      { label: 'Родной город', value: details.hometown },
      { label: 'Дата рождения', value: details.birth_date },
      { label: 'Занятие', value: profile.occupation },
      { label: 'Место работы / проект', value: details.workplace },
      { label: 'Школа', value: details.school },
      { label: 'Образование', value: details.education },
      { label: 'Военная служба', value: details.military_service },
      { label: 'Языки', value: languages.length ? languages.join(', ') : '' },
      { label: 'Сайт / портфолио', value: details.website },
      { label: 'Статус отношений', value: profile.relationship_status },
      { label: 'Жизненная позиция', value: details.worldview },
      { label: 'Любимая цитата', value: details.quote },
    ].filter((item) => String(item.value || '').trim());
  }, [profile.city, profile.handle_raw, profile.occupation, profile.relationship_status, profile.personal_details]);

  const openConnectionProfile = (id) => router.push(`/profile/${id}`);
  const openCommunityFromPanel = (slug) => { if (COMMUNITIES_UI_ENABLED && slug) router.push(`/communities/${slug}`); };
  const openCommunitiesPanel = () => {
    if (!COMMUNITIES_UI_ENABLED) return;
    setConnectionsOpen(false);
    setCommunitiesOpen(true);
  };
  const openConnectionsPanel = (kind) => {
    if (connectionsOpen && connectionsKind === kind) {
      setConnectionsOpen(false);
      return;
    }
    setCommunitiesOpen(false);
    setConnectionsKind(kind);
    setConnectionsOpen(true);
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setProfileError('');
    setProfileMessage('');

    try {
      setSavingProfile(true);
      const profileResponse = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editor),
      });
      const data = await profileResponse.json();
      if (!profileResponse.ok) throw new Error(data.error || 'Не удалось сохранить профиль.');

      const nextProfile = {
        ...profile,
        ...data.profile,
        friendsCount: profile.friendsCount,
        followersCount: profile.followersCount,
        subscriptionsCount: profile.subscriptionsCount,
      };
      setProfile(nextProfile);
      setEditor(createEditableState(nextProfile));
      setEditorOpen(false);
      sessionStorage.setItem('fs_profile', JSON.stringify(nextProfile));
    } catch (error) {
      setProfileError(error.message || 'Не удалось сохранить профиль.');
    } finally {
      setSavingProfile(false);
    }
  };

  const uploadProfileAsset = async (field, file) => {
    if (!file) return;
    setProfileError('');
    setAssetUploadBusy(field);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', 'image');
      form.append('purpose', field === 'cover_url' ? 'cover' : 'avatar');
      const response = await fetch('/api/profile/media/upload', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить изображение.');
      const url = data.media?.url || data.media?.thumbUrl || '';
      if (!url) throw new Error('Загрузка завершилась без ссылки на изображение.');
      setEditor((prev) => ({ ...prev, [field]: url }));
    } catch (error) {
      setProfileError(error.message || 'Не удалось загрузить изображение.');
    } finally {
      setAssetUploadBusy('');
    }
  };

  const clearProfileAsset = (field) => {
    setEditor((prev) => ({ ...prev, [field]: '' }));
  };



  const uploadComposerMedia = async (files) => {
    const picked = Array.from(files || []).slice(0, Math.max(0, 10 - composerMedia.length));
    if (!picked.length) return;
    setComposerUploadBusy(true);
    setPostsError('');
    try {
      const uploaded = [];
      for (const file of picked) {
        const form = new FormData();
        form.append('file', file);
        form.append('kind', file.type?.startsWith('video/') ? 'video' : 'image');
        const response = await fetch('/api/profile/media/upload', { method: 'POST', body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить медиа.');
        if (data.media) uploaded.push(data.media);
      }
      setComposerMedia((prev) => [...prev, ...uploaded].slice(0, 10));
    } catch (error) {
      setPostsError(error.message || 'Не удалось загрузить медиа.');
    } finally {
      setComposerUploadBusy(false);
    }
  };

  const publishPost = async () => {
    const text = composerText.trim();
    if (text.length > POST_TEXT_LIMIT) {
      setPostsError('Текст поста не должен превышать ' + POST_TEXT_LIMIT + ' символов.');
      return;
    }
    if (!text && !composerMedia.length) return;

    try {
      setPublishingPost(true);
      setPostsError('');
      setProfileMessage('');
      const response = await fetch('/api/profile/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, media: composerMedia, location: profile.city || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось опубликовать пост.');
      setProfilePosts((prev) => [data.post, ...prev]);
      setComposerText('');
      setComposerMedia([]);
    } catch (error) {
      setPostsError(error.message || 'Не удалось опубликовать пост.');
    } finally {
      setPublishingPost(false);
    }
  };

  const replacePostSnapshot = (nextPost) => {
    setProfilePosts((prev) => prev.map((item) => (item.id === nextPost.id ? nextPost : item)));
  };

  const patchCommentsForPost = (postId, updater) => {
    setProfilePosts((prev) => prev.map((post) => {
      if (post.id !== postId) return post;
      const nextComments = typeof updater === 'function' ? updater(post.comments || []) : updater;
      return { ...post, comments: nextComments, stats: { ...post.stats, comments: nextComments.length } };
    }));
  };

  const handleVote = async (postId, value) => {
    try {
      setActionBusyKey(`vote:${postId}`);
      const response = await fetch(`/api/feed/posts/${postId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить голос.');
      replacePostSnapshot(data.post);
    } catch (error) {
      setPostsError(error.message || 'Не удалось обновить голос.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleToggleLike = async (post) => {
    try {
      setActionBusyKey(`like:${post.id}`);
      const response = await fetch(`/api/posts/${post.id}/like`, { method: post.is_liked ? 'DELETE' : 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить лайк.');
      replacePostSnapshot(data.post);
    } catch (error) {
      setPostsError(error.message || 'Не удалось обновить лайк.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleToggleSave = async (postId) => {
    try {
      setActionBusyKey(`save:${postId}`);
      const response = await fetch(`/api/feed/posts/${postId}/save`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить сохранение.');
      replacePostSnapshot(data.post);
    } catch (error) {
      setPostsError(error.message || 'Не удалось обновить сохранение.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleAddComment = async (postId, payload) => {
    try {
      setActionBusyKey(`comment:${postId}`);
      const response = await fetch(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: typeof payload === 'string' ? payload : payload?.text,
          reply_to_comment_id: typeof payload === 'object' ? payload?.replyToCommentId || null : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось добавить комментарий.');
      if (data.post) replacePostSnapshot(data.post);
      return true;
    } catch (error) {
      setPostsError(error.message || 'Не удалось добавить комментарий.');
      return false;
    } finally {
      setActionBusyKey('');
    }
  };

  const handleCommentVote = async (commentId, value) => {
    const targetPost = profilePosts.find((post) => (post.comments || []).some((comment) => comment.id === commentId));
    if (!targetPost) return;
    try {
      setActionBusyKey(`comment-vote:${commentId}`);
      const response = await fetch(`/api/comments/${commentId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить голос комментария.');
      if (data.comment) patchCommentsForPost(targetPost.id, (prev) => prev.map((item) => item.id === commentId ? data.comment : item));
    } catch (error) {
      setPostsError(error.message || 'Не удалось обновить голос комментария.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleCommentEdit = async (comment) => {
    const targetPost = profilePosts.find((post) => (post.comments || []).some((item) => item.id === comment.id));
    if (!targetPost || !comment?.is_mine || !comment?.moderation?.can_edit) return;
    const nextText = await actionDialog.askText({ title: 'Изменить комментарий', initialValue: comment.text || '', submitLabel: 'Сохранить' });
    if (nextText == null) return;
    const text = nextText.trim();
    if (!text || text === comment.text) return;

    try {
      setActionBusyKey(`comment-edit:${comment.id}`);
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить комментарий.');
      if (data.comment) patchCommentsForPost(targetPost.id, (prev) => prev.map((item) => item.id === comment.id ? data.comment : item));
    } catch (error) {
      setPostsError(error.message || 'Не удалось обновить комментарий.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleCommentDelete = async (comment) => {
    const targetPost = profilePosts.find((post) => (post.comments || []).some((item) => item.id === comment.id));
    if (!targetPost || !comment?.is_mine || !comment?.moderation?.can_delete) return;
    const confirmed = await actionDialog.confirmAction({ title: 'Удалить комментарий?', text: 'Комментарий исчезнет из обсуждения.', submitLabel: 'Удалить', danger: true });
    if (!confirmed) return;

    try {
      setActionBusyKey(`comment-delete:${comment.id}`);
      const response = await fetch(`/api/comments/${comment.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось удалить комментарий.');
      if (data.comment) patchCommentsForPost(targetPost.id, (prev) => prev.map((item) => item.id === comment.id ? data.comment : item));
    } catch (error) {
      setPostsError(error.message || 'Не удалось удалить комментарий.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleCommentReport = async (comment) => {
    const targetPost = profilePosts.find((post) => (post.comments || []).some((item) => item.id === comment.id));
    if (!targetPost || !comment?.moderation?.can_report) return;
    const reason = await actionDialog.askText({ title: 'Жалоба на комментарий', label: 'Причина', placeholder: 'Спам, оскорбление, обман или другое', submitLabel: 'Отправить' });
    if (reason == null) return;
    const normalized = reason.trim();
    if (!normalized) return;

    try {
      setActionBusyKey(`comment-report:${comment.id}`);
      const response = await fetch(`/api/reports/comments/${comment.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: normalized, details: normalized }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось отправить жалобу на комментарий.');
      if (data.comment) patchCommentsForPost(targetPost.id, (prev) => prev.map((item) => item.id === comment.id ? data.comment : item));
      setProfileMessage(data.message || 'Жалоба отправлена.');
    } catch (error) {
      setPostsError(error.message || 'Не удалось отправить жалобу на комментарий.');
    } finally {
      setActionBusyKey('');
    }
  };


  const handleDeletePost = async (postId) => {
    try {
      setActionBusyKey(`delete:${postId}`);
      const response = await fetch(`/api/profile/posts/${postId}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось удалить пост.');
      setProfilePosts((prev) => prev.filter((item) => item.id !== postId));
      setProfileMessage(data.message || 'Пост удалён.');
    } catch (error) {
      setPostsError(error.message || 'Не удалось удалить пост.');
    } finally {
      setActionBusyKey('');
    }
  };

  const handleReportPost = async (postId) => {
    const reason = await actionDialog.askText({ title: 'Жалоба на публикацию', label: 'Причина', placeholder: 'Спам, оскорбление, обман или другое', submitLabel: 'Отправить' });
    if (reason == null) return;
    const normalized = reason.trim();
    if (!normalized) return;

    try {
      setActionBusyKey(`report:${postId}`);
      const response = await fetch(`/api/reports/posts/${postId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: normalized, details: normalized }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось отправить жалобу.');
      setProfileMessage(data.message || 'Жалоба отправлена.');
    } catch (error) {
      setPostsError(error.message || 'Не удалось отправить жалобу.');
    } finally {
      setActionBusyKey('');
    }
  };


  const handleSharePost = (post) => {
    const postId = Number(post?.id || 0);
    if (!postId) return;
    setShareSheetPost(post);
    setPostsError('');
  };


  const visiblePostsError = postsError && !postsError.toLowerCase().includes('загрузить посты профиля') ? postsError : '';

  const closeEditor = () => {
    setProfileError('');
    setEditor(createEditableState(profile));
    setAssetUploadBusy('');
    setEditorOpen(false);
  };

  if (COMMUNITIES_UI_ENABLED && communitiesOpen) {
    return (
      <ProfileCommunitiesListScreen
        items={profileCommunities}
        hidden={communitiesHidden}
        loading={communitiesLoading}
        onBack={() => setCommunitiesOpen(false)}
        onOpen={openCommunityFromPanel}
      />
    );
  }

  if (connectionsOpen) {
    return (
      <div className="app-shell">
        <div className="app profile-app">
          <main className="screen profileClean-screen">
            <section className="profileClean-card profileClean-panel">
              <div className="profileClean-sectionHead">
                <button type="button" className="profileClean-backBtn" onClick={() => setConnectionsOpen(false)}>← Назад</button>
                <h2 className="profileClean-sectionTitle">{connections.title || 'Связи'}</h2>
              </div>

              {connectionsLoading ? (
                <div className="profileClean-emptyState">Загрузка списка…</div>
              ) : connections.items?.length ? (
                <div className="profileClean-linksList">
                  {connections.items.map((item) => (
                    <button key={`${connectionsKind}-${item.id}`} type="button" className="profileClean-linkRow" onClick={() => openConnectionProfile(item.id)}>
                      <div className={`profileClean-miniAvatar is-${item.tone || 'violet'}`}>{item.initials}</div>
                      <div className="profileClean-linkText">{item.name}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="profileClean-emptyState">Пока список пуст.</div>
              )}
            </section>
          </main>
          <PostAuthBottomNav />
        </div>
      </div>
    );
  }

  if (editorOpen) {
    return (
      <ProfileEditScreen
        editor={editor}
        firstLetter={firstLetter}
        fullName={fullName}
        profile={profile}
        profileError={profileError}
        savingProfile={savingProfile}
        assetUploadBusy={assetUploadBusy}
        onCancel={closeEditor}
        onChange={setEditor}
        onAssetFile={uploadProfileAsset}
        onAssetClear={clearProfileAsset}
        onSubmit={saveProfile}
      />
    );
  }

  return (
    <div className="app-shell">
      <div className="app profile-app">
        <main className="screen profileClean-screen">
          {profileError ? <div className="profileClean-alert is-error">{profileError}</div> : null}
          {visiblePostsError ? <div className="profileClean-alert is-error">{visiblePostsError}</div> : null}

          <section className="profileClean-card profileV2-heroCard">
            <div className={`profileV2-cover is-${profile.cover_tone || profile.tone || 'violet'}`} style={profileAssetStyle(profile.cover_url)} aria-hidden="true" />
            <div className="profileV2-heroTop">
              <div className={`profileClean-avatar profileV2-avatar is-${profile.tone || 'violet'}`}>{profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : firstLetter}</div>
              <button type="button" className="profileClean-iconBtn profileV2-menuBtn" onClick={() => setEditorOpen(true)} aria-label="Редактировать профиль">
                <EditIcon />
              </button>
            </div>

            <div className="profileV2-identity">
              <h1 className="profileClean-name profileV2-name">{fullName}</h1>
              <div className="profileClean-handle profileV2-handle">{profile.handle_raw ? `@${profile.handle_raw}` : '@profile'}</div>
              <p className="profileClean-bio profileV2-bio">{profileLoading ? 'Загружаем профиль…' : description}</p>
              {headline || profile.interests?.length ? (
                <div className="profileClean-chipRow profileV2-tags">
                  {headline ? <span className="profileClean-chip">{headline}</span> : null}
                  {profile.interests?.slice?.(0, 2).map((interest) => <span className="profileClean-chip" key={interest}>{interest}</span>)}
                </div>
              ) : null}
            </div>

            <div className="profileV2-stats" aria-label="Статистика профиля">
              <button type="button" className="profileV2-stat" onClick={() => openConnectionsPanel('friends')}><strong>{profile.friendsCount || 0}</strong><span>Друзья</span></button>
              <button type="button" className="profileV2-stat" onClick={() => openConnectionsPanel('followers')}><strong>{profile.followersCount || 0}</strong><span>Подписчики</span></button>
              <button type="button" className="profileV2-stat" onClick={() => openConnectionsPanel('following')}><strong>{profile.subscriptionsCount || 0}</strong><span>Подписки</span></button>
            </div>

          </section>

          <nav className="profileClean-tabs profileV2-tabs" aria-label="Разделы профиля">
            <ProfileTabButton active={activeTab === 'posts'} onClick={() => setActiveTab('posts')}>Посты</ProfileTabButton>
            <ProfileTabButton active={activeTab === 'media'} onClick={() => setActiveTab('media')}>Медиа</ProfileTabButton>
            <ProfileTabButton active={activeTab === 'about'} onClick={() => setActiveTab('about')}>О себе</ProfileTabButton>
          </nav>

          {activeTab === 'posts' ? (
            <>
              <ProfileInlineComposer
                value={composerText}
                media={composerMedia}
                uploadBusy={composerUploadBusy}
                publishBusy={publishingPost}
                onChange={setComposerText}
                onFiles={uploadComposerMedia}
                onRemoveMedia={(index) => setComposerMedia((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                onSubmit={publishPost}
              />

              {postsLoading ? (
                <div className="profileClean-emptyState">Загружаем ваши посты…</div>
              ) : profilePosts.length ? (
                profilePosts.map((post) => (
                  <ProfilePostCardRich
                    key={post.id}
                    post={post}
                    authorName={fullName}
                    authorHandle={profile.handle_raw ? `@${profile.handle_raw}` : ''}
                    authorInitial={firstLetter}
                    showAuthor
                    allowDelete
                    allowSave
                    busyKey={actionBusyKey}
                    onVote={handleVote}
                    onToggleLike={handleToggleLike}
                    onToggleSave={handleToggleSave}
                    onAddComment={handleAddComment}
                    onCommentVote={handleCommentVote}
                    onCommentEdit={handleCommentEdit}
                    onCommentDelete={handleCommentDelete}
                    onCommentReport={handleCommentReport}
                    onDelete={handleDeletePost}
                    onShare={handleSharePost}
                  />
                ))
              ) : (
                <ProfilePostsEmptyState />
              )}
            </>
          ) : null}

          {activeTab === 'media' ? (
            <ProfileMediaAlbum
              title="Фото и видео"
              subtitle="Чистый альбом без лишних окон и перегруженных плиток."
              items={mediaItems}
              counts={mediaCounts}
              filter={mediaSettings.default_filter}
              onFilterChange={(value) => saveMediaSettings({ default_filter: value })}
              gridMode={mediaSettings.grid_mode}
              onGridModeChange={(value) => saveMediaSettings({ grid_mode: value })}
              showCards={mediaSettings.show_cards}
              onToggleShowCards={(value) => saveMediaSettings({ show_cards: value })}
              loading={mediaLoading}
              error={mediaError}
              saving={mediaSaving}
              persistLabel="Вид альбома сохраняется отдельно от ленты."
            />
          ) : null}




          {activeTab === 'about' ? (
            <>
              <section className="profileClean-card profileClean-panel">
                {profile.interests?.length ? (
                  <div className="profileEdit-aboutInterests">
                    {profile.interests.map((interest) => <span key={interest}>{interest}</span>)}
                  </div>
                ) : null}

                {aboutItems.length ? (
                  <div className="profileClean-aboutList">
                    {aboutItems.map((item) => (
                      <div className="profileClean-aboutItem" key={item.label}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="profileClean-emptyState">Пока нет заполненной информации.</div>
                )}
              </section>
            </>
          ) : null}
        </main>

        <PostShareSheet
          open={Boolean(shareSheetPost)}
          post={shareSheetPost}
          onClose={() => setShareSheetPost(null)}
          onRepostResult={(data, target) => {
            if (data?.original_post) replacePostSnapshot(data.original_post);
            if (data?.post && target?.targetType !== 'community') {
              setProfilePosts((prev) => {
                const exists = prev.some((item) => Number(item.id) === Number(data.post.id));
                if (exists) return prev.map((item) => (Number(item.id) === Number(data.post.id) ? data.post : item));
                return [data.post, ...prev];
              });
            }
          }}
          onChatShareResult={(data) => {
            if (data?.post) replacePostSnapshot(data.post);
          }}
          onSaveToggle={(postId) => handleToggleSave(postId)}
        />

        <MinimalActionDialog {...actionDialog.dialogProps} />
        <PostAuthBottomNav />
      </div>
    </div>
  );
}

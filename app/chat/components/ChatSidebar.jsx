import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StoriesFoundationRail from '@/components/StoriesFoundationRail';
import { MESSAGE_SEARCH_FILTERS, SearchIcon, searchFilterLabel } from './chatViewPrimitives';

const MOMENT_TEXT_LIMIT = 180;
const MOMENT_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

function formatMomentPhotoSize(bytes = 0) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 КБ';
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(size / 1024))} КБ`;
}

function getMomentErrorMessage(error, fallback = 'Не удалось опубликовать момент.') {
  const message = String(error?.message || fallback).trim();
  if (/csrf|forbidden|unauthori[sz]ed|401|403/i.test(message)) {
    return 'Сессия могла устареть. Обновите страницу и попробуйте ещё раз.';
  }
  if (/network|failed to fetch|load failed/i.test(message)) {
    return 'Проверьте соединение и попробуйте ещё раз.';
  }
  return message || fallback;
}

export default function ChatSidebar({
  showList,
  sidebarSubtitle,
  searchPlaceholder,
  search,
  setSearch,
  sidebarMode,
  setSidebarMode,
  requestsCount,
  noticeVisible,
  errorText,
  shouldShowGlobalSearch,
  globalSearchLoading,
  globalSearchResults,
  globalSearchTotal,
  globalSearchType,
  globalSearchError,
  globalSearchFocusedMessageId,
  openSearchResult,
  setGlobalSearchType,
  savedMessagesLoading,
  savedMessagesError,
  savedMessages,
  savedSelectionMode,
  selectedSavedMessages,
  savedMessagesTotal,
  savedActionLoading,
  selectedSavedMessageIds,
  handleBatchUnsaveSavedMessages,
  clearSavedMessageSelection,
  setSavedSelectionMode,
  toggleSavedMessageSelection,
  handleUnsaveSavedMessage,
  loadingChats,
  filteredChats,
  activeChatId,
  openChat,
  loadingRequests,
  filteredRequests,
  openRequestConversation,
  handleRequestAction,
}) {
  const [sidebarControlsHidden, setSidebarControlsHidden] = useState(false);
  const [momentSheetOpen, setMomentSheetOpen] = useState(false);
  const [momentMode, setMomentMode] = useState('text');
  const [momentText, setMomentText] = useState('');
  const [momentPhotoDraft, setMomentPhotoDraft] = useState(null);
  const [momentPublishing, setMomentPublishing] = useState(false);
  const [momentError, setMomentError] = useState('');
  const [momentStatusText, setMomentStatusText] = useState('');
  const [csrfToken, setCsrfToken] = useState('');
  const [localMomentItems, setLocalMomentItems] = useState([]);
  const [momentViewerItem, setMomentViewerItem] = useState(null);
  const momentPublishingRef = useRef(false);
  const momentPhotoInputRef = useRef(null);
  const momentPhotoUrlRef = useRef('');
  const listRef = useRef(null);
  const sidebarTouchRef = useRef({ startX: 0, startY: 0 });

  const cleanMomentText = momentText.trim();
  const hasMomentPhotoDraft = Boolean(momentPhotoDraft?.previewUrl);
  const canPublishMoment = !momentPublishing && (cleanMomentText.length > 0 || (momentMode === 'photo' && hasMomentPhotoDraft));
  const momentViewerMediaUrl = momentViewerItem?.previewUrl || momentViewerItem?.mediaUrl || '';

  const momentPreviewItems = useMemo(() => [
    ...localMomentItems,
    ...(filteredChats || []).slice(0, Math.max(0, 8 - localMomentItems.length)).map((chat) => ({
      id: `chat-moment-${chat.id}`,
      label: chat.name || 'Друг',
      initials: chat.initials,
      tone: chat.tone || 'violet',
      seen: false,
      source: 'chat',
      chatId: chat.id,
      storyId: `chat-${chat.id}`,
      title: `Момент · ${chat.name || 'Друг'}`,
    })),
  ], [filteredChats, localMomentItems]);

  const clearMomentPhotoDraft = useCallback(() => {
    if (momentPhotoUrlRef.current) {
      URL.revokeObjectURL(momentPhotoUrlRef.current);
      momentPhotoUrlRef.current = '';
    }
    setMomentPhotoDraft(null);
    if (momentPhotoInputRef.current) {
      momentPhotoInputRef.current.value = '';
    }
  }, []);

  const resetMomentDraft = useCallback(() => {
    setMomentMode('text');
    setMomentText('');
    setMomentError('');
    setMomentStatusText('');
    clearMomentPhotoDraft();
  }, [clearMomentPhotoDraft]);

  const openMomentSheet = useCallback(() => {
    if (momentPublishingRef.current) return;
    resetMomentDraft();
    setMomentSheetOpen(true);
    setSidebarControlsHidden(false);
  }, [resetMomentDraft]);

  const closeMomentSheet = useCallback(() => {
    if (momentPublishingRef.current) return;
    setMomentSheetOpen(false);
    resetMomentDraft();
  }, [resetMomentDraft]);

  const closeMomentViewer = useCallback(() => {
    setMomentViewerItem(null);
  }, []);

  const openMomentViewer = useCallback((item) => {
    if (!item || item.kind === 'add') return;
    const nextItem = {
      ...item,
      label: item.label || 'Момент',
      title: item.title || item.subtitle || 'Момент',
      subtitle: item.subtitle || item.meta || 'Момент из мессенджера',
      initials: item.initials || 'М',
    };
    setMomentViewerItem(nextItem);
    setLocalMomentItems((items) => items.map((current) => (
      current.storyId && current.storyId === item.storyId ? { ...current, seen: true } : current
    )));
  }, []);

  useEffect(() => () => clearMomentPhotoDraft(), [clearMomentPhotoDraft]);


  useEffect(() => {
    if (!momentSheetOpen && !momentViewerItem) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (momentViewerItem) {
        closeMomentViewer();
        return;
      }
      closeMomentSheet();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeMomentSheet, closeMomentViewer, momentSheetOpen, momentViewerItem]);

  const getCsrfHeaders = useCallback(async (forceRefresh = false) => {
    if (csrfToken && !forceRefresh) return { 'x-csrf-token': csrfToken };
    const response = await fetch('/api/auth/csrf', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    const token = String(data?.csrfToken || '');
    if (!response.ok || !token) throw new Error('Не удалось подготовить безопасную публикацию.');
    setCsrfToken(token);
    return { 'x-csrf-token': token };
  }, [csrfToken]);

  const handleMomentPhotoChange = useCallback((event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;

    const mime = String(file.type || '').toLowerCase();
    if (!mime.startsWith('image/')) {
      setMomentError('Выберите изображение в формате JPG, PNG или WebP.');
      return;
    }
    if ((Number(file.size || 0) || 0) > MOMENT_PHOTO_MAX_BYTES) {
      setMomentError('Фото слишком большое. Максимум — 8 МБ.');
      return;
    }

    clearMomentPhotoDraft();
    const previewUrl = URL.createObjectURL(file);
    momentPhotoUrlRef.current = previewUrl;
    setMomentPhotoDraft({
      file,
      previewUrl,
      name: file.name || 'Фото',
      size: Number(file.size || 0) || 0,
      type: file.type || 'image/*',
    });
    setMomentMode('photo');
    setMomentError('');
  }, [clearMomentPhotoDraft]);


  const uploadMomentPhoto = useCallback(async (file, forceCsrfRefresh = false) => {
    if (!file) return null;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('kind', 'image');
    formData.append('source', 'chat');
    const headers = await getCsrfHeaders(forceCsrfRefresh);
    const response = await fetch('/api/stories/media/upload', {
      method: 'POST',
      headers,
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.media?.url) {
      const error = new Error(data?.error || `Не удалось загрузить фото. Код ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return data.media;
  }, [getCsrfHeaders]);

  const publishMoment = useCallback(async (event) => {
    event.preventDefault();
    if (momentPublishingRef.current) return;

    const text = momentText.trim();
    if (!text && !(momentMode === 'photo' && hasMomentPhotoDraft)) {
      setMomentError(momentMode === 'photo' ? 'Выберите фото или добавьте подпись.' : 'Напишите короткий текст для момента.');
      return;
    }

    try {
      momentPublishingRef.current = true;
      setMomentPublishing(true);
      setMomentError('');

      let uploadedMedia = null;
      if (momentMode === 'photo' && momentPhotoDraft?.file) {
        setMomentStatusText('Загружаю фото…');
        try {
          uploadedMedia = await uploadMomentPhoto(momentPhotoDraft.file, false);
        } catch (error) {
          if (error?.status === 403 || error?.status === 401) {
            setCsrfToken('');
            uploadedMedia = await uploadMomentPhoto(momentPhotoDraft.file, true);
          } else {
            throw error;
          }
        }
      }

      const body = {
        kind: momentMode === 'photo' ? 'photo' : 'text',
        title: text || (momentMode === 'photo' ? 'Фото-момент' : 'Мой момент'),
        subtitle: text || (momentMode === 'photo' ? 'Фото из мессенджера.' : 'Момент опубликован из мессенджера.'),
        source: 'chat',
        audience: 'friends',
        duration_minutes: 24 * 60,
        ...(uploadedMedia ? {
          media_url: uploadedMedia.url,
          preview_url: uploadedMedia.preview_url || uploadedMedia.url,
          duration_ms: uploadedMedia.duration_ms || null,
        } : {}),
      };

      const requestPublish = async (forceCsrfRefresh = false) => {
        const headers = { 'Content-Type': 'application/json', ...(await getCsrfHeaders(forceCsrfRefresh)) };
        const response = await fetch('/api/stories', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.story?.id) {
          const error = new Error(data?.error || `Не удалось опубликовать момент. Код ${response.status}.`);
          error.status = response.status;
          throw error;
        }
        return data.story;
      };

      setMomentStatusText('Публикую момент…');
      let story;
      try {
        story = await requestPublish(false);
      } catch (error) {
        if (error?.status === 403 || error?.status === 401) {
          setCsrfToken('');
          story = await requestPublish(true);
        } else {
          throw error;
        }
      }

      const item = {
        id: `my-moment-${story.id}`,
        label: 'Вы',
        meta: 'только что',
        initials: 'Я',
        tone: story.author?.tone || (momentMode === 'photo' ? 'blue' : 'violet'),
        seen: true,
        source: 'chat',
        storyId: story.id,
        title: story.title || text || 'Мой момент',
        subtitle: story.subtitle || body.subtitle || text || 'Момент опубликован из мессенджера.',
        kind: story.kind || body.kind,
        mediaUrl: story.media_url || uploadedMedia?.url || '',
        previewUrl: story.preview_url || story.media_url || uploadedMedia?.preview_url || uploadedMedia?.url || '',
      };
      setLocalMomentItems((items) => [item, ...items.filter((current) => current.storyId !== item.storyId)].slice(0, 8));
      setMomentSheetOpen(false);
      resetMomentDraft();
    } catch (error) {
      setMomentError(getMomentErrorMessage(error));
    } finally {
      momentPublishingRef.current = false;
      setMomentPublishing(false);
      setMomentStatusText('');
    }
  }, [getCsrfHeaders, hasMomentPhotoDraft, momentMode, momentPhotoDraft, momentText, resetMomentDraft, uploadMomentPhoto]);

  const hideSidebarMoments = useCallback(() => {
    setSidebarControlsHidden((hidden) => (hidden ? hidden : true));
  }, []);

  const showSidebarMoments = useCallback(() => {
    setSidebarControlsHidden((hidden) => (hidden ? false : hidden));
  }, []);

  const handleListScroll = useCallback((event) => {
    if (event.currentTarget.scrollTop > 24) {
      hideSidebarMoments();
    }
  }, [hideSidebarMoments]);

  const handleSidebarWheel = useCallback((event) => {
    const deltaY = Number(event.deltaY || 0);
    const deltaX = Number(event.deltaX || 0);
    if (Math.abs(deltaX) > Math.abs(deltaY)) return;

    if (deltaY > 12) {
      hideSidebarMoments();
      return;
    }

    if (deltaY < -18 && sidebarControlsHidden && (listRef.current?.scrollTop || 0) <= 0) {
      showSidebarMoments();
    }
  }, [hideSidebarMoments, showSidebarMoments, sidebarControlsHidden]);

  const handleSidebarTouchStart = useCallback((event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    sidebarTouchRef.current = { startX: touch.clientX, startY: touch.clientY };
  }, []);

  const handleSidebarTouchEnd = useCallback((event) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;

    const gesture = sidebarTouchRef.current;
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;

    if (Math.abs(deltaX) > Math.abs(deltaY) * 1.2) return;

    if (deltaY < -28) {
      hideSidebarMoments();
      return;
    }

    if (deltaY > 44 && sidebarControlsHidden && (listRef.current?.scrollTop || 0) <= 0) {
      showSidebarMoments();
    }
  }, [hideSidebarMoments, showSidebarMoments, sidebarControlsHidden]);

  return (
    <aside
      className={`chatW-sidebar ${showList ? 'is-mobile-visible' : 'is-mobile-hidden'} ${sidebarControlsHidden ? 'is-controls-hidden' : ''}`}
      onWheel={handleSidebarWheel}
      onTouchStart={handleSidebarTouchStart}
      onTouchEnd={handleSidebarTouchEnd}
    >
      <div className="chatW-sidebar-head">
        <div>
          <div className="chatW-title">Чаты</div>
          <div className="chatW-subtitle">{sidebarSubtitle}</div>
        </div>
      </div>


      <div className="chatW-search">
        <SearchIcon />
        <input type="text" placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
        {search ? (
          <button type="button" className="chatW-searchClearBtn" onClick={() => setSearch('')} aria-label="Очистить поиск">×</button>
        ) : null}
      </div>

      <div className={`chatW-scrollControls ${sidebarControlsHidden ? 'is-hidden' : ''}`}>
        {sidebarMode === 'chats' ? (
          <div className="chatW-momentsSlot" aria-hidden={sidebarControlsHidden ? 'true' : undefined}>
            <StoriesFoundationRail
              title="Моменты"
              subtitle="Быстрые обновления теперь живут рядом с переписками."
              items={momentPreviewItems}
              showCreateRing
              createLabel="Мой момент"
              createMeta="создать"
              source="chat"
              compact
              onCreate={openMomentSheet}
              onSelect={openMomentViewer}
            />
          </div>
        ) : null}

        {sidebarMode !== 'requests' ? (
          <div className="chatW-searchFilterRow chatW-searchFilterRow--sidebarSurface">
            {MESSAGE_SEARCH_FILTERS.map((filter) => (
              <button
                key={`sidebar-filter-${filter.id || 'all'}`}
                type="button"
                className={`chatW-searchFilterChip ${globalSearchType === filter.id ? 'is-active' : ''}`}
                onClick={() => setGlobalSearchType(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="chatW-filters">
          <button type="button" className={sidebarMode === 'chats' ? 'is-active' : ''} onClick={() => setSidebarMode('chats')}>Все</button>
          <button type="button" className={sidebarMode === 'saved' ? 'is-active' : ''} onClick={() => setSidebarMode('saved')}>Сохранённые</button>
          <button type="button" className={sidebarMode === 'requests' ? 'is-active' : ''} onClick={() => setSidebarMode('requests')}>Запросы{requestsCount ? ` · ${requestsCount}` : ''}</button>
          <button type="button" className={sidebarMode === 'archived' ? 'is-active' : ''} onClick={() => setSidebarMode('archived')}>Архив</button>
        </div>
      </div>

      {momentSheetOpen ? (
        <div className="chatW-momentSheetBackdrop" role="presentation" onMouseDown={momentPublishing ? undefined : closeMomentSheet}>
          <form
            className="chatW-momentSheet"
            onSubmit={publishMoment}
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="chatMomentSheetTitle"
          >
            <div className="chatW-momentSheetHandle" />
            <div className="chatW-momentSheetHead">
              <div>
                <div className="chatW-momentSheetTitle" id="chatMomentSheetTitle">Новый момент</div>
                <div className="chatW-momentSheetText">Опубликуется в мессенджере, рядом с чатами.</div>
              </div>
              <button type="button" className="chatW-momentSheetClose" onClick={closeMomentSheet} aria-label="Закрыть" disabled={momentPublishing}>×</button>
            </div>

            <div className="chatW-momentModeRow" role="tablist" aria-label="Тип момента">
              <button type="button" className={`chatW-momentModeBtn ${momentMode === 'text' ? 'is-active' : ''}`} onClick={() => { setMomentMode('text'); setMomentError(''); clearMomentPhotoDraft(); }} disabled={momentPublishing}>Текст</button>
              <button type="button" className={`chatW-momentModeBtn ${momentMode === 'photo' ? 'is-active' : ''}`} onClick={() => { setMomentMode('photo'); setMomentError(''); }} disabled={momentPublishing}>Фото</button>
            </div>

            <input
              ref={momentPhotoInputRef}
              className="chatW-momentPhotoInput"
              type="file"
              accept="image/*"
              onChange={handleMomentPhotoChange}
              disabled={momentPublishing}
            />

            <button
              type="button"
              className={`chatW-momentPreview is-${momentMode} ${hasMomentPhotoDraft ? 'has-photo' : ''}`.trim()}
              onClick={momentMode === 'photo' && !momentPublishing ? () => momentPhotoInputRef.current?.click() : undefined}
              disabled={momentPublishing}
              tabIndex={momentMode === 'photo' ? undefined : -1}
              aria-label={momentMode === 'photo' ? 'Выбрать фото для момента' : undefined}
            >
              {hasMomentPhotoDraft ? <img className="chatW-momentPreviewImage" src={momentPhotoDraft.previewUrl} alt="Выбранное фото" /> : null}
              <span className="chatW-momentPreviewOverlay" aria-hidden={hasMomentPhotoDraft ? 'true' : undefined}>
                <span className="chatW-momentPreviewBadge">Мой момент</span>
                <span className="chatW-momentPreviewText">{momentText.trim() || (momentMode === 'photo' ? (hasMomentPhotoDraft ? 'Фото готово' : 'Нажмите, чтобы выбрать фото') : 'Что происходит сейчас?')}</span>
              </span>
            </button>

            {momentMode === 'photo' ? (
              <div className="chatW-momentPhotoTools">
                {hasMomentPhotoDraft ? (
                  <div className="chatW-momentPhotoPicked">
                    <span className="chatW-momentPhotoName">{momentPhotoDraft.name}</span>
                    <span className="chatW-momentPhotoSize">{formatMomentPhotoSize(momentPhotoDraft.size)}</span>
                    <button type="button" onClick={clearMomentPhotoDraft} disabled={momentPublishing}>Убрать</button>
                  </div>
                ) : (
                  <button type="button" className="chatW-momentPhotoPickBtn" onClick={() => momentPhotoInputRef.current?.click()} disabled={momentPublishing}>Выбрать фото</button>
                )}
              </div>
            ) : null}

            <label className="chatW-momentField">
              <span>{momentMode === 'photo' ? 'Подпись' : 'Текст момента'}</span>
              <textarea
                value={momentText}
                onChange={(event) => {
                  setMomentText(event.target.value);
                  if (momentError) setMomentError('');
                }}
                maxLength={MOMENT_TEXT_LIMIT}
                rows={3}
                placeholder={momentMode === 'photo' ? 'Добавьте короткую подпись' : 'Напишите короткое обновление'}
                disabled={momentPublishing}
              />
              <span className="chatW-momentCounter">{cleanMomentText.length}/{MOMENT_TEXT_LIMIT}</span>
            </label>
            {momentError ? <div className="chatW-momentError" role="alert">{momentError}</div> : null}
            {momentPublishing ? <div className="chatW-momentStatus" role="status">{momentStatusText || 'Публикую момент…'}</div> : null}

            <div className="chatW-momentSheetActions">
              <button type="button" className="chatW-momentGhostBtn" onClick={closeMomentSheet} disabled={momentPublishing}>Отмена</button>
              <button type="submit" className="chatW-momentPrimaryBtn" disabled={!canPublishMoment}>{momentPublishing ? 'Публикую…' : 'Опубликовать'}</button>
            </div>
          </form>
        </div>
      ) : null}

      {momentViewerItem ? (
        <div className="chatW-momentViewerBackdrop" role="presentation" onMouseDown={closeMomentViewer}>
          <article
            className={`chatW-momentViewer ${momentViewerMediaUrl ? 'has-media' : ''}`}
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="chatMomentViewerTitle"
          >
            {momentViewerMediaUrl ? <img className="chatW-momentViewerImage" src={momentViewerMediaUrl} alt="Момент" /> : null}
            <div className="chatW-momentViewerShade" />
            <div className="chatW-momentViewerTop">
              <div className={`chatW-avatar is-${momentViewerItem.tone || 'violet'} chatW-momentViewerAvatar`}>{momentViewerItem.initials || 'М'}</div>
              <div className="chatW-momentViewerMeta">
                <div className="chatW-momentViewerAuthor">{momentViewerItem.label || 'Момент'}</div>
                <div className="chatW-momentViewerTime">{momentViewerItem.meta || 'сейчас'}</div>
              </div>
              <button type="button" className="chatW-momentViewerClose" onClick={closeMomentViewer} aria-label="Закрыть момент">×</button>
            </div>
            <div className="chatW-momentViewerBody">
              <div className="chatW-momentViewerBadge">Момент</div>
              <h3 className="chatW-momentViewerTitle" id="chatMomentViewerTitle">{momentViewerItem.title || 'Момент'}</h3>
              {momentViewerItem.subtitle ? <p className="chatW-momentViewerText">{momentViewerItem.subtitle}</p> : null}
            </div>
          </article>
        </div>
      ) : null}

      {noticeVisible ? <div className="chatW-notice" role="status" aria-live="polite">{errorText}</div> : null}
      {shouldShowGlobalSearch ? (
        <div className="chatW-globalSearchBlock">
          <div className="chatW-globalSearchHead">
            <strong>Сообщения</strong>
            <span>
              {globalSearchLoading
                ? 'Ищу…'
                : globalSearchResults.length
                  ? `Найдено: ${globalSearchTotal}${globalSearchType ? ` · ${searchFilterLabel(globalSearchType)}` : ''}`
                  : `Совпадений пока нет${globalSearchType ? ` · ${searchFilterLabel(globalSearchType)}` : ''}`}
            </span>
          </div>
          {globalSearchError ? <div className="chatW-globalSearchError">{globalSearchError}</div> : null}
          {globalSearchResults.length ? (
            <div className="chatW-globalSearchList">
              {globalSearchResults.map((result) => (
                <button
                  key={`${result.conversation_id}:${result.message_id}`}
                  type="button"
                  className={`chatW-globalSearchItem ${globalSearchFocusedMessageId === result.message_id ? 'is-active' : ''}`}
                  onClick={() => openSearchResult(result)}
                >
                  <span className={`chatW-avatar is-${result.conversation?.tone || 'violet'} chatW-globalSearchAvatar`}>{result.conversation?.initials || 'Ч'}</span>
                  <span className="chatW-globalSearchMeta">
                    <span className="chatW-globalSearchTop">
                      <span className="chatW-globalSearchChat">{result.conversation?.name || 'Диалог'}</span>
                      <span className="chatW-globalSearchTime">{result.time}</span>
                    </span>
                    <span className="chatW-globalSearchSender">{result.is_mine ? 'Вы' : (result.sender?.name || 'Пользователь')}</span>
                    <span className="chatW-globalSearchSnippet">{result.snippet || result.preview_text}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (!globalSearchLoading && !globalSearchError ? <div className="chatW-globalSearchEmpty">По этому запросу в сообщениях пока ничего не нашлось.</div> : null)}
        </div>
      ) : null}

      <div ref={listRef} className="chatW-list" onScroll={handleListScroll}>
        {sidebarMode === 'saved' ? (
          <>
            {!savedMessagesLoading && !savedMessagesError && savedMessages.length ? (
              <div className="chatW-savedToolbar">
                <div className="chatW-savedToolbarMain">
                  <strong>Сохранённые</strong>
                  <span>{savedSelectionMode ? `Выбрано: ${selectedSavedMessages.length}` : `${savedMessagesTotal || savedMessages.length} сообщений`}</span>
                </div>
                <div className="chatW-savedToolbarActions">
                  {savedSelectionMode ? (
                    <>
                      <button type="button" onClick={handleBatchUnsaveSavedMessages} disabled={savedActionLoading || !selectedSavedMessageIds.length}>
                        {savedActionLoading ? 'Убираю…' : selectedSavedMessageIds.length > 1 ? `Убрать (${selectedSavedMessageIds.length})` : 'Убрать'}
                      </button>
                      <button type="button" onClick={clearSavedMessageSelection} disabled={savedActionLoading}>Отмена</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setSavedSelectionMode(true)} disabled={savedActionLoading}>Выбрать</button>
                  )}
                </div>
              </div>
            ) : null}
            {savedMessagesLoading ? <div className="chatW-empty">Загружаю сохранённые сообщения…</div> : null}
            {!savedMessagesLoading && savedMessagesError ? <div className="chatW-empty">{savedMessagesError}</div> : null}
            {!savedMessagesLoading && !savedMessagesError && !savedMessages.length ? <div className="chatW-empty">Сохранённых сообщений пока нет.</div> : null}
            {!savedMessagesLoading && !savedMessagesError && savedMessages.map((result) => {
              const savedMessageId = String(result.message_id || result?.message?.id || '');
              const savedSelected = selectedSavedMessageIds.includes(savedMessageId);
              return (
                <div key={result.saved_id || `${result.conversation_id}:${result.message_id}`} className={`chatW-savedRow ${savedSelected ? 'is-selected' : ''}`}>
                  <button
                    type="button"
                    className={`chatW-globalSearchItem chatW-savedRowMain ${globalSearchFocusedMessageId === result.message_id ? 'is-active' : ''} ${savedSelectionMode ? 'is-selection-mode' : ''} ${savedSelected ? 'is-selected' : ''}`}
                    onClick={() => {
                      if (savedSelectionMode) {
                        toggleSavedMessageSelection(result);
                        return;
                      }
                      openSearchResult(result);
                    }}
                  >
                    {savedSelectionMode ? <span className={`chatW-savedSelectTick ${savedSelected ? 'is-checked' : ''}`}>{savedSelected ? '✓' : ''}</span> : null}
                    <span className={`chatW-avatar is-${result.conversation?.tone || 'violet'} chatW-globalSearchAvatar`}>{result.conversation?.initials || 'С'}</span>
                    <span className="chatW-globalSearchMeta">
                      <span className="chatW-globalSearchTop">
                        <span className="chatW-globalSearchChat">{result.conversation?.name || 'Диалог'}</span>
                        <span className="chatW-globalSearchTime">{result.saved_time || result.time}</span>
                      </span>
                      <span className="chatW-globalSearchSender">{result.is_mine ? 'Вы' : (result.sender?.name || 'Пользователь')}</span>
                      <span className="chatW-globalSearchSnippet">{result.snippet || result.preview_text}</span>
                    </span>
                  </button>
                  {!savedSelectionMode ? (
                    <button
                      type="button"
                      className="chatW-savedQuickAction"
                      onClick={() => handleUnsaveSavedMessage(result)}
                      disabled={savedActionLoading}
                    >
                      {savedActionLoading ? '…' : 'Убрать'}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </>
        ) : sidebarMode !== 'requests' ? (
          <>
            {loadingChats ? <div className="chatW-empty">Загружаю диалоги…</div> : null}
            {!loadingChats && !filteredChats.length ? <div className="chatW-empty">{sidebarMode === 'archived' ? 'В архиве пока ничего нет.' : 'Диалогов пока нет.'}</div> : null}
            {!loadingChats && filteredChats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={`chatW-chatrow ${chat.id === activeChatId ? 'is-active' : ''}`}
                onClick={() => openChat(chat.id)}
              >
                <span className={`chatW-avatar is-${chat.tone || 'violet'}`}>{chat.initials}</span>
                <span className="chatW-chatmeta">
                  <span className="chatW-chatline1">
                    <span className="chatW-chatname">{chat.name}</span>
                    <span className="chatW-chattime">{chat.time}</span>
                  </span>
                  <span className="chatW-chatline2">
                    <span className={`chatW-chatpreview ${chat.draft_text ? 'is-draft' : ''}`}>{chat.preview}</span>
                    <span className="chatW-rowbadges">
                      {chat.pinned ? <span className="chatW-flag">PIN</span> : null}
                      {chat.muted ? <span className="chatW-flag is-muted">MUTE</span> : null}
                      {chat.request_state === 'outgoing' ? <span className="chatW-requestBadge">запрос</span> : null}
                      {chat.unread > 0 ? <span className="chatW-unread">{chat.unread}</span> : null}
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </>
        ) : (
          <>
            {loadingRequests ? <div className="chatW-empty">Загружаю запросы…</div> : null}
            {!loadingRequests && !filteredRequests.length ? <div className="chatW-empty">Новых запросов на переписку пока нет.</div> : null}
            {!loadingRequests && filteredRequests.map((request) => (
              <div key={`${request.direction}-${request.id}`} className="chatW-requestCard">
                <button type="button" className="chatW-chatrow chatW-chatrow-request" onClick={() => openRequestConversation(request)}>
                  <span className={`chatW-avatar is-${request.person?.tone || 'violet'}`}>{request.person?.initials || 'Ч'}</span>
                  <span className="chatW-chatmeta">
                    <span className="chatW-chatline1">
                      <span className="chatW-chatname">{request.person?.name}</span>
                      <span className="chatW-chattime">{new Date(request.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</span>
                    </span>
                    <span className="chatW-chatline2">
                      <span className="chatW-chatpreview">{request.preview_text}</span>
                    </span>
                    <span className="chatW-requestHint">{request.direction === 'incoming' ? 'Ждёт вашего решения' : 'Ожидает принятия'}</span>
                  </span>
                </button>
                {request.direction === 'incoming' ? (
                  <div className="chatW-requestActions">
                    <button type="button" onClick={() => handleRequestAction(request.id, 'accept', request.conversation_id)}>Принять</button>
                    <button type="button" onClick={() => handleRequestAction(request.id, 'reject')}>Отклонить</button>
                    <button type="button" onClick={() => handleRequestAction(request.id, 'block')}>Заблокировать</button>
                  </div>
                ) : null}
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

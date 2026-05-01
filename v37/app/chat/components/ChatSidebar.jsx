import StoriesFoundationRail from '@/components/StoriesFoundationRail';
import { MESSAGE_SEARCH_FILTERS, SearchIcon, searchFilterLabel } from './chatViewPrimitives';

export default function ChatSidebar({
  showList,
  sidebarSubtitle,
  momentItems,
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
  return (
    <aside className={`chatW-sidebar ${showList ? 'is-mobile-visible' : 'is-mobile-hidden'}`}>
      <div className="chatW-sidebar-head">
        <div>
          <div className="chatW-title">Чаты</div>
          <div className="chatW-subtitle">{sidebarSubtitle}</div>
        </div>
      </div>


      {Array.isArray(momentItems) && momentItems.length ? (
        <div className="chatW-momentsSlot">
          <StoriesFoundationRail
            title=""
            subtitle=""
            items={momentItems}
            source="chat"
            compact
            showCreateRing={false}
          />
        </div>
      ) : null}

      <div className="chatW-search">
        <SearchIcon />
        <input type="text" placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
        {search ? (
          <button type="button" className="chatW-searchClearBtn" onClick={() => setSearch('')} aria-label="Очистить поиск">×</button>
        ) : null}
      </div>

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

      <div className="chatW-list">
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

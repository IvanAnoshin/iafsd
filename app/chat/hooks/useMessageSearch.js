'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function getSearchResultMessageId(item) {
  return String(item?.message_id || item?.message?.id || '').trim();
}

function clearResultList(setter, totalSetter, errorSetter) {
  setter([]);
  totalSetter?.(0);
  errorSetter?.('');
}

export function useMessageSearch({
  activeChatId,
  sidebarMode,
  searchQuery,
  usingFallback,
  messages = [],
  readJsonSafe,
  mergeMessages,
  setMessages,
  setErrorText,
  loadMessageContextIntoTimeline,
  onOpenConversationResult,
}) {
  const conversationSearchInputRef = useRef(null);

  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [conversationSearchQuery, setConversationSearchQuery] = useState('');
  const [conversationSearchType, setConversationSearchType] = useState('');
  const [conversationSearchResults, setConversationSearchResults] = useState([]);
  const [conversationSearchLoading, setConversationSearchLoading] = useState(false);
  const [conversationSearchError, setConversationSearchError] = useState('');
  const [conversationSearchCurrentIndex, setConversationSearchCurrentIndex] = useState(-1);
  const [conversationSearchFocusedMessageId, setConversationSearchFocusedMessageId] = useState(null);

  const [globalSearchResults, setGlobalSearchResults] = useState([]);
  const [globalSearchType, setGlobalSearchType] = useState('');
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState('');
  const [globalSearchTotal, setGlobalSearchTotal] = useState(0);
  const [globalSearchFocusedMessageId, setGlobalSearchFocusedMessageId] = useState(null);
  const [pendingGlobalSearchJump, setPendingGlobalSearchJump] = useState(null);

  const [savedMessages, setSavedMessages] = useState([]);
  const [savedMessagesLoading, setSavedMessagesLoading] = useState(false);
  const [savedMessagesError, setSavedMessagesError] = useState('');
  const [savedMessagesTotal, setSavedMessagesTotal] = useState(0);
  const [savedSelectionMode, setSavedSelectionMode] = useState(false);
  const [selectedSavedMessageIds, setSelectedSavedMessageIds] = useState([]);
  const [savedActionLoading, setSavedActionLoading] = useState(false);

  const shouldShowSavedMessages = sidebarMode === 'saved' && !usingFallback;
  const shouldShowGlobalSearch = sidebarMode !== 'requests' && sidebarMode !== 'saved' && !usingFallback && (searchQuery.trim().length >= 2 || Boolean(globalSearchType));

  const selectedSavedMessages = useMemo(() => {
    if (!selectedSavedMessageIds.length) return [];
    const index = new Map(savedMessages.map((item) => [getSearchResultMessageId(item), item]).filter(([id]) => Boolean(id)));
    return selectedSavedMessageIds.map((id) => index.get(String(id))).filter(Boolean);
  }, [savedMessages, selectedSavedMessageIds]);

  const currentConversationSearchMessageId = useMemo(() => {
    if (conversationSearchCurrentIndex < 0) return null;
    return conversationSearchResults[conversationSearchCurrentIndex]?.message_id || null;
  }, [conversationSearchCurrentIndex, conversationSearchResults]);

  const activeChatHasEncryptedMessages = useMemo(
    () => (Array.isArray(messages) ? messages : []).some((item) => Boolean(item?.is_encrypted || item?.isEncrypted)),
    [messages],
  );

  const conversationSearchNotice = useMemo(() => {
    if (!activeChatHasEncryptedMessages) return '';
    if (conversationSearchType) return 'Поиск по типам работает, но текст защищённых сообщений в результаты не попадает.';
    if (conversationSearchQuery.trim().length >= 2) return 'Текстовый поиск не просматривает защищённые сообщения. Для них используйте дату, ответ, закрепы или ручную прокрутку.';
    return 'В этом чате есть защищённые сообщения. Их текст не участвует в поиске по переписке.';
  }, [activeChatHasEncryptedMessages, conversationSearchQuery, conversationSearchType]);

  const openConversationSearch = useCallback(() => {
    if (!activeChatId || usingFallback) return;
    setConversationSearchOpen((prev) => {
      const next = !prev;
      if (!next) {
        setConversationSearchCurrentIndex(-1);
        setConversationSearchFocusedMessageId(null);
      }
      return next;
    });
  }, [activeChatId, usingFallback]);

  const runGlobalMessageSearch = useCallback(async (query, typeOverride = globalSearchType) => {
    const normalized = String(query || '').trim();
    const normalizedType = String(typeOverride || '').trim().toLowerCase();
    if ((normalized.length < 2 && !normalizedType) || sidebarMode === 'requests' || usingFallback) {
      clearResultList(setGlobalSearchResults, setGlobalSearchTotal, setGlobalSearchError);
      if (normalized.length < 2 && !normalizedType) setGlobalSearchFocusedMessageId(null);
      return;
    }
    setGlobalSearchLoading(true);
    setGlobalSearchError('');
    try {
      const params = new URLSearchParams({ limit: '8' });
      if (normalized) params.set('q', normalized);
      if (normalizedType) params.set('type', normalizedType);
      const response = await fetch(`/api/messages/search?${params.toString()}`, { cache: 'no-store' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload) throw new Error(payload?.error || 'Не удалось выполнить поиск по сообщениям.');
      const items = Array.isArray(payload.items) ? payload.items : [];
      setGlobalSearchResults(items);
      setGlobalSearchTotal(Number(payload.total) || items.length);
    } catch (error) {
      console.error('global message search failed', error);
      clearResultList(setGlobalSearchResults, setGlobalSearchTotal, setGlobalSearchError);
      setGlobalSearchError(error?.message || 'Не удалось выполнить поиск по сообщениям.');
    } finally {
      setGlobalSearchLoading(false);
    }
  }, [globalSearchType, readJsonSafe, sidebarMode, usingFallback]);

  const runSavedMessages = useCallback(async (query, typeOverride = globalSearchType) => {
    if (sidebarMode !== 'saved' || usingFallback) {
      clearResultList(setSavedMessages, setSavedMessagesTotal, setSavedMessagesError);
      return;
    }
    const normalized = String(query || '').trim();
    const normalizedType = String(typeOverride || '').trim().toLowerCase();
    setSavedMessagesLoading(true);
    setSavedMessagesError('');
    try {
      const params = new URLSearchParams({ limit: '40' });
      if (normalized) params.set('q', normalized);
      if (normalizedType) params.set('type', normalizedType);
      const response = await fetch(`/api/messages/saved?${params.toString()}`, { cache: 'no-store' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload) throw new Error(payload?.error || 'Не удалось загрузить сохранённые сообщения.');
      const items = Array.isArray(payload.items) ? payload.items : [];
      setSavedMessages(items);
      setSavedMessagesTotal(Number(payload.total) || items.length);
    } catch (error) {
      console.error('saved messages list failed', error);
      clearResultList(setSavedMessages, setSavedMessagesTotal, setSavedMessagesError);
      setSavedMessagesError(error?.message || 'Не удалось загрузить сохранённые сообщения.');
    } finally {
      setSavedMessagesLoading(false);
    }
  }, [globalSearchType, readJsonSafe, sidebarMode, usingFallback]);

  const runConversationSearch = useCallback(async (query, options = {}) => {
    if (!activeChatId || usingFallback) return;
    const normalized = String(query || '').trim();
    const normalizedType = String((options.type ?? conversationSearchType) || '').trim().toLowerCase();
    if (normalized.length < 2 && !normalizedType) {
      setConversationSearchResults([]);
      setConversationSearchCurrentIndex(-1);
      setConversationSearchError('');
      if (!options.preserveFocus) setConversationSearchFocusedMessageId(null);
      return;
    }
    setConversationSearchLoading(true);
    setConversationSearchError('');
    try {
      const params = new URLSearchParams({ limit: '25' });
      if (normalized) params.set('q', normalized);
      if (normalizedType) params.set('type', normalizedType);
      const response = await fetch(`/api/chats/${activeChatId}/search?${params.toString()}`, { cache: 'no-store' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload) throw new Error(payload?.error || 'Не удалось выполнить поиск по переписке.');
      const items = Array.isArray(payload.items) ? payload.items : [];
      setConversationSearchResults(items);
      if (!items.length) {
        setConversationSearchCurrentIndex(-1);
        setConversationSearchFocusedMessageId(null);
        return;
      }
      const preferredId = options.preferredMessageId || currentConversationSearchMessageId;
      const nextIndex = preferredId ? items.findIndex((item) => item.message_id === preferredId) : 0;
      const safeIndex = nextIndex >= 0 ? nextIndex : 0;
      setConversationSearchCurrentIndex(safeIndex);
      if (options.focusFirst !== false) {
        void loadMessageContextIntoTimeline(items[safeIndex]?.message_id, { select: false });
      }
    } catch (error) {
      console.error('conversation search failed', error);
      setConversationSearchResults([]);
      setConversationSearchCurrentIndex(-1);
      setConversationSearchFocusedMessageId(null);
      setConversationSearchError(error?.message || 'Не удалось выполнить поиск по переписке.');
    } finally {
      setConversationSearchLoading(false);
    }
  }, [activeChatId, conversationSearchType, currentConversationSearchMessageId, loadMessageContextIntoTimeline, readJsonSafe, usingFallback]);

  const goToConversationSearchResult = useCallback(async (index) => {
    if (index < 0 || index >= conversationSearchResults.length) return;
    const target = conversationSearchResults[index];
    if (!target?.message_id) return;
    setConversationSearchCurrentIndex(index);
    await loadMessageContextIntoTimeline(target.message_id, { select: false });
  }, [conversationSearchResults, loadMessageContextIntoTimeline]);

  const stepConversationSearchResult = useCallback((direction = 1) => {
    if (!conversationSearchResults.length) return;
    const baseIndex = conversationSearchCurrentIndex >= 0 ? conversationSearchCurrentIndex : 0;
    const nextIndex = (baseIndex + direction + conversationSearchResults.length) % conversationSearchResults.length;
    void goToConversationSearchResult(nextIndex);
  }, [conversationSearchCurrentIndex, conversationSearchResults, goToConversationSearchResult]);

  const openSearchResult = useCallback(async (result) => {
    if (!result?.message_id || !result?.conversation_id) return;
    setGlobalSearchFocusedMessageId(result.message_id);
    if (String(result.conversation_id) === String(activeChatId)) {
      await loadMessageContextIntoTimeline(result.message_id, { select: true });
      return;
    }
    setPendingGlobalSearchJump({ conversationId: String(result.conversation_id), messageId: String(result.message_id) });
    onOpenConversationResult?.(result);
  }, [activeChatId, loadMessageContextIntoTimeline, onOpenConversationResult]);

  const clearSavedMessageSelection = useCallback(() => {
    setSelectedSavedMessageIds([]);
    setSavedSelectionMode(false);
  }, []);

  const toggleSavedMessageSelection = useCallback((result) => {
    const messageId = getSearchResultMessageId(result);
    if (!messageId) return;
    setSelectedSavedMessageIds((prev) => prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId]);
  }, []);

  const handleUnsaveSavedMessage = useCallback(async (result) => {
    const messageId = getSearchResultMessageId(result);
    if (!messageId || usingFallback) return;
    setSavedActionLoading(true);
    try {
      const response = await fetch(`/api/messages/${messageId}/save`, { method: 'DELETE' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.message) throw new Error(payload?.error || 'Не удалось убрать сообщение из сохранённых.');
      setMessages((prev) => mergeMessages(prev, [payload.message], 'append'));
      setSavedMessages((prev) => prev.filter((item) => getSearchResultMessageId(item) !== messageId));
      setSavedMessagesTotal((prev) => Math.max(0, Number(prev) - 1));
      setSelectedSavedMessageIds((prev) => prev.filter((id) => id !== messageId));
      setErrorText('');
    } catch (error) {
      console.error('saved message unsave failed', error);
      setErrorText(error?.message || 'Не удалось убрать сообщение из сохранённых.');
    } finally {
      setSavedActionLoading(false);
    }
  }, [mergeMessages, readJsonSafe, setErrorText, setMessages, usingFallback]);

  const handleBatchUnsaveSavedMessages = useCallback(async () => {
    if (!selectedSavedMessageIds.length || usingFallback) return;
    setSavedActionLoading(true);
    try {
      const response = await fetch('/api/messages/saved/batch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: selectedSavedMessageIds }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload) throw new Error(payload?.error || 'Не удалось убрать выбранные сообщения из сохранённых.');
      const removedIds = Array.isArray(payload.messageIds) ? payload.messageIds.map((value) => String(value)) : [];
      if (removedIds.length) {
        const removedSet = new Set(removedIds);
        setMessages((prev) => prev.map((item) => removedSet.has(String(item.id || item.client_id || '')) ? { ...item, is_saved: false } : item));
        setSavedMessages((prev) => prev.filter((item) => !removedSet.has(getSearchResultMessageId(item))));
      }
      const removedCount = Number(payload.removedCount) || removedIds.length || 0;
      setSavedMessagesTotal((prev) => Math.max(0, Number(prev) - removedCount));
      clearSavedMessageSelection();
      setErrorText('');
    } catch (error) {
      console.error('batch unsave saved messages failed', error);
      setErrorText(error?.message || 'Не удалось убрать выбранные сообщения из сохранённых.');
    } finally {
      setSavedActionLoading(false);
    }
  }, [clearSavedMessageSelection, readJsonSafe, selectedSavedMessageIds, setErrorText, setMessages, usingFallback]);

  const applySavedMessageMutation = useCallback((message) => {
    if (!message || sidebarMode !== 'saved') return;
    if (message.is_saved) {
      void runSavedMessages(searchQuery, globalSearchType);
      return;
    }
    const messageId = String(message.id || '').trim();
    setSavedMessages((prev) => prev.filter((item) => getSearchResultMessageId(item) !== messageId));
    setSavedMessagesTotal((prev) => Math.max(0, Number(prev) - 1));
    setSelectedSavedMessageIds((prev) => prev.filter((id) => id !== messageId));
  }, [globalSearchType, runSavedMessages, searchQuery, sidebarMode]);

  useEffect(() => {
    setConversationSearchOpen(false);
    setConversationSearchQuery('');
    setConversationSearchType('');
    setConversationSearchResults([]);
    setConversationSearchLoading(false);
    setConversationSearchError('');
    setConversationSearchCurrentIndex(-1);
    setConversationSearchFocusedMessageId(null);
  }, [activeChatId, setConversationSearchOpen]);

  useEffect(() => {
    if (!conversationSearchOpen || usingFallback || !activeChatId) return undefined;
    const timeout = window.setTimeout(() => {
      void runConversationSearch(conversationSearchQuery, { type: conversationSearchType });
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [conversationSearchOpen, conversationSearchQuery, conversationSearchType, activeChatId, runConversationSearch, usingFallback]);

  useEffect(() => {
    if (!conversationSearchOpen) return undefined;
    const timeout = window.setTimeout(() => {
      conversationSearchInputRef.current?.focus?.();
    }, 30);
    return () => window.clearTimeout(timeout);
  }, [conversationSearchOpen]);

  useEffect(() => {
    if (!shouldShowGlobalSearch) {
      clearResultList(setGlobalSearchResults, setGlobalSearchTotal, setGlobalSearchError);
      if (!searchQuery.trim() && !globalSearchType) setGlobalSearchFocusedMessageId(null);
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      void runGlobalMessageSearch(searchQuery, globalSearchType);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [globalSearchType, runGlobalMessageSearch, searchQuery, shouldShowGlobalSearch]);

  useEffect(() => {
    if (!shouldShowSavedMessages) {
      clearResultList(setSavedMessages, setSavedMessagesTotal, setSavedMessagesError);
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      void runSavedMessages(searchQuery, globalSearchType);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [globalSearchType, runSavedMessages, searchQuery, shouldShowSavedMessages]);

  useEffect(() => {
    if (sidebarMode === 'saved') return undefined;
    setSavedSelectionMode(false);
    setSelectedSavedMessageIds([]);
    return undefined;
  }, [sidebarMode]);

  useEffect(() => {
    if (!savedSelectionMode) return undefined;
    setSelectedSavedMessageIds((prev) => prev.filter((id) => savedMessages.some((item) => getSearchResultMessageId(item) === String(id))));
    return undefined;
  }, [savedMessages, savedSelectionMode]);

  useEffect(() => {
    if (savedSelectionMode && !selectedSavedMessageIds.length) {
      setSavedSelectionMode(false);
    }
  }, [savedSelectionMode, selectedSavedMessageIds]);

  useEffect(() => {
    if (!pendingGlobalSearchJump || usingFallback) return undefined;
    if (pendingGlobalSearchJump.conversationId !== activeChatId) return undefined;
    const timeout = window.setTimeout(() => {
      void loadMessageContextIntoTimeline(pendingGlobalSearchJump.messageId, { select: true });
      setPendingGlobalSearchJump(null);
    }, 60);
    return () => window.clearTimeout(timeout);
  }, [activeChatId, loadMessageContextIntoTimeline, pendingGlobalSearchJump, usingFallback]);

  return {
    conversationSearchInputRef,
    conversationSearchOpen,
    setConversationSearchOpen,
    conversationSearchQuery,
    setConversationSearchQuery,
    conversationSearchType,
    setConversationSearchType,
    conversationSearchResults,
    conversationSearchLoading,
    conversationSearchError,
    conversationSearchNotice,
    setConversationSearchError,
    conversationSearchCurrentIndex,
    conversationSearchFocusedMessageId,
    setConversationSearchFocusedMessageId,
    openConversationSearch,
    stepConversationSearchResult,
    goToConversationSearchResult,
    globalSearchResults,
    globalSearchType,
    setGlobalSearchType,
    globalSearchLoading,
    globalSearchError,
    globalSearchTotal,
    globalSearchFocusedMessageId,
    savedMessages,
    savedMessagesLoading,
    savedMessagesError,
    savedMessagesTotal,
    savedSelectionMode,
    setSavedSelectionMode,
    selectedSavedMessageIds,
    selectedSavedMessages,
    savedActionLoading,
    shouldShowSavedMessages,
    shouldShowGlobalSearch,
    openSearchResult,
    clearSavedMessageSelection,
    toggleSavedMessageSelection,
    handleUnsaveSavedMessage,
    handleBatchUnsaveSavedMessages,
    applySavedMessageMutation,
  };
}

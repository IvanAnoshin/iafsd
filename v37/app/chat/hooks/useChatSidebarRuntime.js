'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function normalizeScope(sidebarMode = 'chats', explicitScope = '') {
  const raw = String(explicitScope || '').trim().toLowerCase();
  if (raw === 'active' || raw === 'archived') return raw;
  return String(sidebarMode || '').trim().toLowerCase() === 'archived' ? 'archived' : 'active';
}

function includesQuery(value, query) {
  return String(value || '').toLowerCase().includes(query);
}

export function useChatSidebarRuntime({
  search,
  chats,
  setChats,
  fallbackChatsSeed,
  activeChatId,
  setActiveChatId,
  usingFallback,
  setUsingFallback,
  readJsonSafe,
  setErrorText,
  loadMessages,
  setConversationMeta,
  setMessages,
  setShowList,
  setSelectedMessageId,
  setEditingMessageId,
  setReplyingTo,
  setComposerMode,
  setChatMenuOpen,
}) {
  const [loadingChats, setLoadingChats] = useState(true);
  const [sidebarMode, setSidebarMode] = useState('chats');
  const [requests, setRequests] = useState({ incoming: [], outgoing: [], count: 0 });
  const [loadingRequests, setLoadingRequests] = useState(false);

  const refreshChatsTimeoutRef = useRef(null);
  const sidebarModeRef = useRef('chats');
  const latestChatsRequestRef = useRef(0);
  const latestRequestsRequestRef = useRef(0);
  const activeChatIdRef = useRef(activeChatId);
  const chatsRef = useRef(chats);
  const didInitSidebarEffectRef = useRef(false);

  useEffect(() => {
    sidebarModeRef.current = sidebarMode;
  }, [sidebarMode]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  const filteredRequests = useMemo(() => {
    const q = String(search || '').trim().toLowerCase();
    const rows = [...(requests.incoming || []), ...(requests.outgoing || [])];
    if (!q) return rows;
    return rows.filter((item) => includesQuery([item.person?.name, item.person?.handle, item.preview_text, item.direction].join(' '), q));
  }, [requests, search]);

  const filteredChats = useMemo(() => {
    const q = String(search || '').trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((chat) => includesQuery([chat.name, chat.preview, chat.status, chat.peer?.handle, chat.request_state].join(' '), q));
  }, [chats, search]);

  const activeChat = useMemo(() => {
    return chats.find((chat) => chat.id === activeChatId) || filteredChats[0] || chats[0] || fallbackChatsSeed[0] || null;
  }, [activeChatId, chats, fallbackChatsSeed, filteredChats]);

  const hydrateActiveChatFromList = useCallback((items, preferredChatId = null) => {
    const normalizedPreferred = preferredChatId ? String(preferredChatId) : '';
    const normalizedCurrent = activeChatIdRef.current ? String(activeChatIdRef.current) : '';
    const availableIds = new Set((items || []).map((item) => String(item?.id || '')));
    const nextActiveId = normalizedPreferred && availableIds.has(normalizedPreferred)
      ? normalizedPreferred
      : normalizedCurrent && availableIds.has(normalizedCurrent)
        ? normalizedCurrent
        : (items?.[0]?.id ? String(items[0].id) : '');

    if (nextActiveId) {
      if (nextActiveId !== normalizedCurrent) setActiveChatId(nextActiveId);
    } else if (normalizedCurrent) {
      setActiveChatId(null);
    }
  }, [setActiveChatId]);

  const loadChats = useCallback(async (preferredChatId = null, scopeOverride = '', options = {}) => {
    const requestId = ++latestChatsRequestRef.current;
    const scope = normalizeScope(sidebarModeRef.current, scopeOverride);
    const silent = Boolean(options.silent);
    if (!silent) setLoadingChats(true);

    try {
      const params = new URLSearchParams();
      params.set('limit', '60');
      params.set('scope', scope);
      const response = await fetch(`/api/chats?${params.toString()}`, { cache: 'no-store' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload) throw new Error(payload?.error || 'Не удалось загрузить список чатов.');
      if (requestId !== latestChatsRequestRef.current) return payload;

      const items = Array.isArray(payload.items) ? payload.items : [];
      setChats(items);
      if (usingFallback) setUsingFallback(false);
      hydrateActiveChatFromList(items, preferredChatId);
      return payload;
    } catch (error) {
      console.error('chat sidebar loadChats failed', error);
      const hasExistingChats = Boolean(chatsRef.current?.length);
      if (!hasExistingChats && Array.isArray(fallbackChatsSeed) && fallbackChatsSeed.length) {
        setUsingFallback(true);
        setChats(fallbackChatsSeed);
        hydrateActiveChatFromList(fallbackChatsSeed, preferredChatId);
      }
      setErrorText(error?.message || 'Не удалось загрузить список чатов.');
      return null;
    } finally {
      if (!silent) setLoadingChats(false);
    }
  }, [fallbackChatsSeed, hydrateActiveChatFromList, readJsonSafe, setChats, setErrorText, setUsingFallback, usingFallback]);

  const loadRequests = useCallback(async (options = {}) => {
    const requestId = ++latestRequestsRequestRef.current;
    const silent = Boolean(options.silent);
    const shouldReportError = Boolean(options.reportError);
    if (!silent) setLoadingRequests(true);
    try {
      const response = await fetch('/api/message-requests?limit=30', { cache: 'no-store' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload) throw new Error(payload?.error || 'Не удалось загрузить запросы на переписку.');
      if (requestId !== latestRequestsRequestRef.current) return payload;
      const nextRequests = {
        incoming: Array.isArray(payload.incoming) ? payload.incoming : [],
        outgoing: Array.isArray(payload.outgoing) ? payload.outgoing : [],
        count: Number(payload.count || 0) || 0,
      };
      setRequests(nextRequests);
      return nextRequests;
    } catch (error) {
      console.error('chat sidebar loadRequests failed', error);
      if (shouldReportError) setErrorText(error?.message || 'Не удалось загрузить запросы на переписку.');
      return null;
    } finally {
      if (!silent) setLoadingRequests(false);
    }
  }, [readJsonSafe, setErrorText]);

  const scheduleChatsRefresh = useCallback((preferredChatId = null, scopeOverride = '') => {
    if (refreshChatsTimeoutRef.current && typeof window !== 'undefined') {
      window.clearTimeout(refreshChatsTimeoutRef.current);
    }
    if (typeof window === 'undefined') {
      loadChats(preferredChatId, scopeOverride, { silent: true }).catch(() => null);
      return;
    }
    refreshChatsTimeoutRef.current = window.setTimeout(() => {
      refreshChatsTimeoutRef.current = null;
      loadChats(preferredChatId, scopeOverride, { silent: true }).catch(() => null);
    }, 220);
  }, [loadChats]);

  const resetOpenConversationUi = useCallback(() => {
    setSelectedMessageId(null);
    setEditingMessageId(null);
    setReplyingTo(null);
    setComposerMode('send');
    setChatMenuOpen(false);
  }, [setChatMenuOpen, setComposerMode, setEditingMessageId, setReplyingTo, setSelectedMessageId]);

  const openChat = useCallback((chatId) => {
    setActiveChatId(chatId);
    setShowList(false);
    resetOpenConversationUi();
  }, [resetOpenConversationUi, setActiveChatId, setShowList]);

  const openRequestConversation = useCallback(async (request) => {
    const conversationId = request?.conversation_id ? String(request.conversation_id) : '';
    if (!conversationId) return;
    setActiveChatId(conversationId);
    setSidebarMode('chats');
    setShowList(false);
    resetOpenConversationUi();
    await loadMessages(conversationId, { mode: 'replace' });
  }, [loadMessages, resetOpenConversationUi, setActiveChatId, setShowList]);

  const handleRequestAction = useCallback(async (requestId, action, conversationId = null) => {
    try {
      const response = await fetch(`/api/message-requests/${requestId}/${action}`, { method: 'POST' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Не удалось обработать запрос.');

      await Promise.all([
        loadRequests({ silent: true }),
        loadChats(conversationId || activeChatIdRef.current || null, '', { silent: true }),
      ]);

      const normalizedConversationId = conversationId ? String(conversationId) : '';
      if (action === 'accept' && normalizedConversationId) {
        setActiveChatId(normalizedConversationId);
        setSidebarMode('chats');
        setShowList(false);
        resetOpenConversationUi();
        await loadMessages(normalizedConversationId, { mode: 'replace' });
      } else if (normalizedConversationId && normalizedConversationId === String(activeChatIdRef.current || '')) {
        setShowList(true);
        setConversationMeta(null);
        setMessages([]);
        setActiveChatId(null);
      }
    } catch (error) {
      console.error('message request action failed', error);
      setErrorText(error?.message || 'Не удалось обработать запрос на переписку.');
    }
  }, [loadChats, loadMessages, loadRequests, readJsonSafe, resetOpenConversationUi, setActiveChatId, setConversationMeta, setErrorText, setMessages, setShowList]);

  useEffect(() => {
    loadChats().catch(() => null);
    loadRequests().catch(() => null);
    return () => {
      if (refreshChatsTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(refreshChatsTimeoutRef.current);
      }
    };
  }, [loadChats, loadRequests]);

  useEffect(() => {
    if (!didInitSidebarEffectRef.current) {
      didInitSidebarEffectRef.current = true;
      return;
    }
    if (sidebarMode === 'requests' || usingFallback) return;
    loadChats(activeChatIdRef.current || null, normalizeScope(sidebarMode)).catch(() => null);
  }, [loadChats, sidebarMode, usingFallback]);

  return {
    loadingChats,
    setLoadingChats,
    sidebarMode,
    setSidebarMode,
    sidebarModeRef,
    requests,
    setRequests,
    loadingRequests,
    filteredRequests,
    filteredChats,
    activeChat,
    loadChats,
    loadRequests,
    scheduleChatsRefresh,
    openChat,
    handleRequestAction,
    openRequestConversation,
  };
}

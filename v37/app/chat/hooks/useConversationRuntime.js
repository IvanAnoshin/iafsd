'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decryptConversationItems } from '@/lib/e2ee-client';

export function useConversationRuntime({
  initialCacheRef,
  chats,
  showList,
  message,
  setMessage,
  composerMode,
  usingFallback,
  setChats,
  setErrorText,
  readJsonSafe,
  mergeMessages,
  canAutoMarkConversationRead,
  emitMessengerTelemetry,
  pickLiveCall,
  setActiveCall,
}) {
  const [activeChatId, setActiveChatId] = useState(null);
  const [conversationMeta, setConversationMeta] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [chatSwitchPending, setChatSwitchPending] = useState(false);
  const [chatSwitchTargetId, setChatSwitchTargetId] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [peerPresence, setPeerPresence] = useState(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [pinnedMessagesLoading, setPinnedMessagesLoading] = useState(false);
  const [pinnedCurrentIndex, setPinnedCurrentIndex] = useState(0);

  const draftSnapshotRef = useRef({});
  const peerTypingTimeoutRef = useRef(null);
  const readSyncTimeoutRef = useRef(null);
  const activeChatIdRef = useRef(null);
  const currentPeerIdRef = useRef(null);
  const messagesRef = useRef([]);
  const chatViewCacheRef = useRef(new Map());
  const pinnedCacheByChatRef = useRef(new Map());
  const latestMessagesRequestRef = useRef(0);
  const latestPinnedRequestRef = useRef(0);
  const latestPresenceRequestRef = useRef(0);
  const latestTypingRequestRef = useRef(0);
  const latestCallsRequestRef = useRef(0);

  const clearPeerTypingTimeout = useCallback(() => {
    if (peerTypingTimeoutRef.current && typeof window !== 'undefined') {
      window.clearTimeout(peerTypingTimeoutRef.current);
    }
    peerTypingTimeoutRef.current = null;
  }, []);

  const schedulePeerTypingExpiry = useCallback((expiresAt) => {
    clearPeerTypingTimeout();
    if (typeof window === 'undefined') return;
    const expiryTs = expiresAt ? new Date(expiresAt).getTime() : 0;
    const timeoutMs = Number.isFinite(expiryTs) && expiryTs > 0
      ? Math.max(1200, Math.min(12000, expiryTs - Date.now() + 250))
      : 6500;
    peerTypingTimeoutRef.current = window.setTimeout(() => {
      setPeerTyping(false);
      peerTypingTimeoutRef.current = null;
    }, timeoutMs);
  }, [clearPeerTypingTimeout]);

  const requestMarkConversationRead = useCallback((chatId, options = {}) => {
    if (!chatId || usingFallback) return;
    const force = Boolean(options.force);
    if (!force && !canAutoMarkConversationRead({ activeChatId: chatId, showList })) return;
    if (readSyncTimeoutRef.current && typeof window !== 'undefined') {
      window.clearTimeout(readSyncTimeoutRef.current);
      readSyncTimeoutRef.current = null;
    }
    const delay = options.immediate ? 80 : 220;
    if (typeof window === 'undefined') {
      fetch(`/api/chats/${chatId}/read`, { method: 'POST' }).catch(() => null);
      return;
    }
    readSyncTimeoutRef.current = window.setTimeout(() => {
      readSyncTimeoutRef.current = null;
      fetch(`/api/chats/${chatId}/read`, { method: 'POST' })
        .then(() => {
          setChats((prev) => prev.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)));
        })
        .catch(() => null);
    }, delay);
  }, [canAutoMarkConversationRead, setChats, showList, usingFallback]);

  const loadConversationCalls = useCallback(async (chatId) => {
    if (!chatId || usingFallback) return;
    const requestKey = ++latestCallsRequestRef.current;
    try {
      const response = await fetch(`/api/chat/calls?conversation_id=${chatId}&limit=8`, { cache: 'no-store' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload) throw new Error(payload?.error || 'Не удалось загрузить состояние звонков.');
      if (requestKey !== latestCallsRequestRef.current) return;
      if (String(activeChatIdRef.current || '') !== String(chatId)) return;
      setActiveCall(pickLiveCall(payload.active));
    } catch (error) {
      console.error('chat calls load failed', error);
    }
  }, [pickLiveCall, readJsonSafe, setActiveCall, usingFallback]);

  const loadMessages = useCallback(async (chatId, options = {}) => {
    if (!chatId || usingFallback) return;
    const cursor = options.cursor || '';
    const mode = options.mode || 'replace';
    const silent = Boolean(options.silent && !cursor);
    const requestKey = mode === 'replace' && !cursor ? ++latestMessagesRequestRef.current : latestMessagesRequestRef.current;
    const startedAt = Date.now();
    if (cursor) setLoadingOlder(true); else if (!silent) setLoadingMessages(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', cursor ? '30' : '40');
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`/api/chats/${chatId}/messages?${params.toString()}`, { cache: 'no-store' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload) throw new Error(payload?.error || 'Не удалось загрузить сообщения.');
      if (mode === 'replace' && !cursor) {
        if (requestKey !== latestMessagesRequestRef.current) return;
        if (String(activeChatIdRef.current || '') !== String(chatId)) return;
      } else if (String(activeChatIdRef.current || '') !== String(chatId)) {
        return;
      }
      setConversationMeta(payload.conversation || null);
      setNextCursor(payload.nextCursor || null);
      setHasMore(Boolean(payload.hasMore));
      const incoming = Array.isArray(payload.items) ? payload.items : [];
      const decryptedIncoming = await decryptConversationItems(incoming).catch(() => incoming);
      setMessages((prev) => mode === 'prepend' ? mergeMessages(prev, decryptedIncoming, 'prepend') : mergeMessages([], decryptedIncoming, 'append'));
      if (mode === 'replace' && !cursor) {
        setChatSwitchPending(false);
        setChatSwitchTargetId(null);
        chatViewCacheRef.current.set(String(chatId), {
          conversation: payload.conversation || null,
          items: incoming,
          nextCursor: payload.nextCursor || null,
          hasMore: Boolean(payload.hasMore),
          draftText: String(payload.conversation?.draft_text || ''),
        });
      }
      if (mode === 'replace' && composerMode !== 'edit') {
        const draftText = String(payload.conversation?.draft_text || '');
        draftSnapshotRef.current[chatId] = draftText;
        setMessage(draftText);
      }
      if (mode === 'replace') {
        requestMarkConversationRead(chatId, { immediate: true });
      }
      setChats((prev) => prev.map((chat) => (chat.id === chatId ? { ...chat, unread: 0, draft_text: payload.conversation?.draft_text || '' } : chat)));
      if (mode === 'replace' && !cursor) {
        emitMessengerTelemetry?.({
          category: 'chat',
          metric: 'open',
          outcome: 'success',
          conversationId: chatId,
          durationMs: Date.now() - startedAt,
          details: { messages: incoming.length },
        });
      }
    } catch (error) {
      console.error('chat page loadMessages failed', error);
      if (mode === 'replace' && !cursor && String(activeChatIdRef.current || '') === String(chatId)) {
        setChatSwitchPending(false);
        setChatSwitchTargetId(null);
      }
      if (mode === 'replace' && !cursor) {
        emitMessengerTelemetry?.({
          category: 'chat',
          metric: 'open',
          outcome: 'error',
          conversationId: chatId,
          durationMs: Date.now() - startedAt,
          details: { error: error?.message || 'unknown_error' },
        });
      }
      setErrorText(error?.message || 'Не удалось загрузить сообщения.');
    } finally {
      if (!silent) setLoadingMessages(false);
      setLoadingOlder(false);
    }
  }, [composerMode, emitMessengerTelemetry, mergeMessages, readJsonSafe, requestMarkConversationRead, setChats, setErrorText, setMessage, usingFallback]);

  const loadPinnedMessages = useCallback(async (chatId, options = {}) => {
    if (!chatId || usingFallback) {
      setPinnedMessages([]);
      setPinnedCurrentIndex(0);
      return;
    }
    const silent = Boolean(options.silent);
    const requestKey = ++latestPinnedRequestRef.current;
    if (!silent) setPinnedMessagesLoading(true);
    try {
      const response = await fetch(`/api/chats/${chatId}/pins`, { cache: 'no-store' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload) throw new Error(payload?.error || 'Не удалось загрузить закрепы.');
      if (requestKey !== latestPinnedRequestRef.current) return;
      if (String(activeChatIdRef.current || '') !== String(chatId)) return;
      const items = Array.isArray(payload.items) ? payload.items : [];
      pinnedCacheByChatRef.current.set(String(chatId), items);
      setPinnedMessages(items);
      setPinnedCurrentIndex((prev) => {
        if (!items.length) return 0;
        return Math.min(Math.max(prev, 0), items.length - 1);
      });
    } catch (error) {
      console.error('chat page loadPinnedMessages failed', error);
    } finally {
      if (!silent) setPinnedMessagesLoading(false);
    }
  }, [readJsonSafe, usingFallback]);

  const loadPeerPresence = useCallback(async (peerId) => {
    if (!peerId || usingFallback) {
      setPeerPresence(null);
      return;
    }
    const requestKey = ++latestPresenceRequestRef.current;
    try {
      const response = await fetch(`/api/users/${peerId}/presence`, { cache: 'no-store' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.presence) throw new Error(payload?.error || 'Не удалось получить статус пользователя.');
      if (requestKey !== latestPresenceRequestRef.current) return;
      if (Number(currentPeerIdRef.current || 0) !== Number(peerId || 0)) return;
      setPeerPresence(payload.presence);
    } catch (error) {
      console.error('chat page loadPeerPresence failed', error);
    }
  }, [readJsonSafe, usingFallback]);

  const loadTypingSnapshot = useCallback(async (chatId, peerId) => {
    if (!chatId || !peerId || usingFallback) {
      setPeerTyping(false);
      return;
    }
    const requestKey = ++latestTypingRequestRef.current;
    try {
      const response = await fetch(`/api/chats/${chatId}/typing`, { cache: 'no-store' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !Array.isArray(payload?.items)) throw new Error(payload?.error || 'Не удалось получить статус набора.');
      if (requestKey !== latestTypingRequestRef.current) return;
      if (String(activeChatIdRef.current || '') !== String(chatId)) return;
      if (Number(currentPeerIdRef.current || 0) !== Number(peerId || 0)) return;
      const peerEntry = payload.items.find((item) => Number(item?.userId) === Number(peerId) && item?.active);
      const isPeerTyping = Boolean(peerEntry);
      setPeerTyping(isPeerTyping);
      if (isPeerTyping) {
        schedulePeerTypingExpiry(peerEntry?.expiresAt || peerEntry?.expires_at || null);
      } else {
        clearPeerTypingTimeout();
      }
    } catch (error) {
      console.error('chat page loadTypingSnapshot failed', error);
    }
  }, [clearPeerTypingTimeout, readJsonSafe, schedulePeerTypingExpiry, usingFallback]);

  const currentPeerId = useMemo(() => {
    const chatPeerId = chats.find((chat) => chat.id === activeChatId)?.peer?.id || null;
    return conversationMeta?.peer?.id || chatPeerId || null;
  }, [activeChatId, chats, conversationMeta?.peer?.id]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    currentPeerIdRef.current = currentPeerId;
  }, [currentPeerId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const cachedState = initialCacheRef.current;
    if (!cachedState?.activeChatId || !Array.isArray(cachedState.messages) || !cachedState.messages.length) return;
    const chatId = String(cachedState.activeChatId);
    if (!chatViewCacheRef.current.has(chatId)) {
      chatViewCacheRef.current.set(chatId, {
        conversation: cachedState.conversationMeta || null,
        items: cachedState.messages,
        nextCursor: cachedState.nextCursor || null,
        hasMore: Boolean(cachedState.hasMore),
        draftText: String(cachedState.message || ''),
      });
    }
  }, [initialCacheRef]);

  useEffect(() => {
    return () => {
      if (readSyncTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(readSyncTimeoutRef.current);
        readSyncTimeoutRef.current = null;
      }
      clearPeerTypingTimeout();
    };
  }, [clearPeerTypingTimeout]);

  useEffect(() => {
    if (!activeChatId || usingFallback) {
      setChatSwitchPending(false);
      setChatSwitchTargetId(null);
      return;
    }
    const cachedView = chatViewCacheRef.current.get(String(activeChatId));
    if (cachedView) {
      setConversationMeta(cachedView.conversation || null);
      setMessages(Array.isArray(cachedView.items) ? cachedView.items : []);
      setNextCursor(cachedView.nextCursor || null);
      setHasMore(Boolean(cachedView.hasMore));
      setChatSwitchPending(false);
      setChatSwitchTargetId(null);
      if (composerMode !== 'edit') {
        draftSnapshotRef.current[activeChatId] = cachedView.draftText || '';
        setMessage(cachedView.draftText || '');
      }
    } else {
      setConversationMeta(null);
      setNextCursor(null);
      setHasMore(false);
      setChatSwitchPending(true);
      setChatSwitchTargetId(activeChatId);
    }
    const cachedPins = pinnedCacheByChatRef.current.get(String(activeChatId));
    if (cachedPins) {
      setPinnedMessages(cachedPins);
      setPinnedCurrentIndex((prev) => Math.min(Math.max(prev, 0), Math.max(cachedPins.length - 1, 0)));
      setPinnedMessagesLoading(false);
    } else {
      setPinnedMessagesLoading(true);
      setPinnedCurrentIndex(0);
    }
    loadMessages(activeChatId, { mode: 'replace', silent: Boolean(cachedView) });
    loadPinnedMessages(activeChatId, { silent: Boolean(cachedPins) });
    clearPeerTypingTimeout();
    setPeerTyping(false);
  }, [activeChatId, clearPeerTypingTimeout, composerMode, loadMessages, loadPinnedMessages, setMessage, usingFallback]);

  useEffect(() => {
    if (!activeChatId || usingFallback) return undefined;
    const syncIfVisible = () => {
      requestMarkConversationRead(activeChatId, { immediate: true });
    };
    syncIfVisible();
    if (typeof window === 'undefined') return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncIfVisible();
    };
    const onFocus = () => syncIfVisible();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [activeChatId, requestMarkConversationRead, usingFallback]);

  useEffect(() => {
    loadPeerPresence(currentPeerId);
    loadTypingSnapshot(activeChatId, currentPeerId);
  }, [activeChatId, currentPeerId, loadPeerPresence, loadTypingSnapshot]);

  useEffect(() => {
    if (!activeChatId || usingFallback) return undefined;
    loadConversationCalls(activeChatId).catch(() => null);
  }, [activeChatId, loadConversationCalls, usingFallback]);

  return {
    activeChatId,
    setActiveChatId,
    conversationMeta,
    setConversationMeta,
    messages,
    setMessages,
    messagesRef,
    loadingMessages,
    chatSwitchPending,
    chatSwitchTargetId,
    loadingOlder,
    nextCursor,
    setNextCursor,
    hasMore,
    setHasMore,
    peerPresence,
    setPeerPresence,
    peerTyping,
    setPeerTyping,
    pinnedMessages,
    setPinnedMessages,
    pinnedMessagesLoading,
    setPinnedMessagesLoading,
    pinnedCurrentIndex,
    setPinnedCurrentIndex,
    chatViewCacheRef,
    pinnedCacheByChatRef,
    activeChatIdRef,
    currentPeerIdRef,
    draftSnapshotRef,
    clearPeerTypingTimeout,
    schedulePeerTypingExpiry,
    requestMarkConversationRead,
    loadConversationCalls,
    loadMessages,
    loadPinnedMessages,
    loadPeerPresence,
    loadTypingSnapshot,
  };
}

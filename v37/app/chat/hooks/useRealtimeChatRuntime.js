import { useEffect, useRef } from 'react';
import { decryptMessagePayload } from '@/lib/e2ee-client';

export function useRealtimeChatRuntime({
  usingFallback,
  sidebarMode,
  readJsonSafe,
  emitMessengerTelemetry,
  normalizeMessage,
  mergeMessages,
  activeChatIdRef,
  currentPeerIdRef,
  activeCallIdRef,
  requestMarkConversationRead,
  loadConversationCalls,
  loadMessages,
  loadPinnedMessages,
  loadPeerPresence,
  loadTypingSnapshot,
  loadChats,
  loadRequests,
  scheduleChatsRefresh,
  setMessages,
  setPeerPresence,
  setPeerTyping,
  clearPeerTypingTimeout,
  schedulePeerTypingExpiry,
  setActiveCall,
  pickLiveCall,
  setCallClientStatus,
  setCallClientError,
  processIncomingCallSignal,
  setErrorText,
  setRealtimeState,
}) {
  const eventSourceRef = useRef(null);
  const handledStreamEventIdsRef = useRef(new Map());
  const lastStreamEventIdRef = useRef(0);
  const streamReadyCountRef = useRef(0);
  const realtimeDisconnectStateRef = useRef({ active: false, startedAt: 0, lastAttemptAt: 0 });
  const reconnectSyncTimeoutRef = useRef(null);

  function parseStreamPayload(evt) {
    try {
      return JSON.parse(evt?.data || '{}');
    } catch {
      return null;
    }
  }

  function rememberStreamEventId(rawEventId) {
    const numericId = Number(rawEventId || 0);
    if (!Number.isInteger(numericId) || numericId <= 0) return true;
    const registry = handledStreamEventIdsRef.current;
    if (registry.has(numericId)) return false;
    registry.set(numericId, Date.now());
    lastStreamEventIdRef.current = Math.max(lastStreamEventIdRef.current, numericId);
    while (registry.size > 400) {
      const oldestKey = registry.keys().next().value;
      if (oldestKey == null) break;
      registry.delete(oldestKey);
    }
    return true;
  }

  function shouldHandleStreamEvent(evt) {
    return rememberStreamEventId(evt?.lastEventId || '');
  }

  async function recoverRealtimeState(options = {}) {
    if (usingFallback) return;
    const resetRequired = Boolean(options?.resetRequired);
    const chatId = activeChatIdRef.current;
    const peerId = currentPeerIdRef.current;
    const scope = sidebarMode === 'archived' ? 'archived' : 'active';

    const tasks = [
      loadChats(chatId || null, scope).catch(() => null),
      loadRequests().catch(() => null),
      chatId ? loadPinnedMessages(chatId).catch(() => null) : Promise.resolve(),
      chatId ? loadConversationCalls(chatId).catch(() => null) : Promise.resolve(),
      peerId ? loadPeerPresence(peerId).catch(() => null) : Promise.resolve(),
      chatId && peerId ? loadTypingSnapshot(chatId, peerId).catch(() => null) : Promise.resolve(),
      resetRequired && chatId ? loadMessages(chatId, { mode: 'replace' }).catch(() => null) : Promise.resolve(),
    ];

    await Promise.all(tasks);
  }


  function clearReconnectSyncTimeout() {
    if (reconnectSyncTimeoutRef.current && typeof window !== 'undefined') {
      window.clearTimeout(reconnectSyncTimeoutRef.current);
    }
    reconnectSyncTimeoutRef.current = null;
  }

  function scheduleReconnectRecovery() {
    if (usingFallback || typeof window === 'undefined' || reconnectSyncTimeoutRef.current) return;
    reconnectSyncTimeoutRef.current = window.setTimeout(() => {
      reconnectSyncTimeoutRef.current = null;
      setRealtimeState?.({ status: 'syncing', text: 'Проверяю пропущенные события и синхронизирую чат…' });
      recoverRealtimeState({ resetRequired: true })
        .catch(() => null)
        .finally(() => {
          if (realtimeDisconnectStateRef.current.active) {
            setRealtimeState?.({ status: 'reconnecting', text: 'Ожидаю переподключение realtime…' });
          }
        });
    }, 6500);
  }

  function collectMessageKeys(message, payload = null) {
    const keys = new Set();
    const payloadMessageIds = Array.isArray(payload?.messageIds) ? payload.messageIds : [];
    [message?.id, message?.client_id, payload?.messageId, payload?.clientId, ...payloadMessageIds].forEach((value) => {
      const next = String(value || '').trim();
      if (next) keys.add(next);
    });
    return keys;
  }

  function applyDeletedMessage(prev, payload) {
    if (payload?.message) return mergeMessages(prev, [payload.message], 'append');
    const removedKeys = collectMessageKeys(null, payload);
    if (!removedKeys.size) return prev;
    return prev.filter((item) => {
      const itemId = String(item?.id || '').trim();
      const clientId = String(item?.client_id || '').trim();
      return (!itemId || !removedKeys.has(itemId)) && (!clientId || !removedKeys.has(clientId));
    });
  }

  function applyReadReceipt(prev, payload) {
    if (!payload) return prev;
    const explicitKeys = collectMessageKeys(null, payload);
    const rawReadAt = payload?.readAt || payload?.read_at || null;
    const readAt = rawReadAt ? new Date(rawReadAt).getTime() : 0;
    return prev.map((item) => {
      if (!item?.is_mine) return item;
      const itemId = String(item?.id || '').trim();
      const clientId = String(item?.client_id || '').trim();
      const createdAt = new Date(item?.created_at || item?.updated_at || 0).getTime();
      const matchesExplicit = (itemId && explicitKeys.has(itemId)) || (clientId && explicitKeys.has(clientId));
      const matchesReadAt = Number.isFinite(readAt) && readAt > 0 && Number.isFinite(createdAt) && createdAt > 0 && createdAt <= readAt;
      if (!matchesExplicit && !matchesReadAt) return item;
      return {
        ...item,
        state: 'read',
        delivered_at: item?.delivered_at || rawReadAt || item?.created_at || null,
      };
    });
  }

  useEffect(() => {
    if (usingFallback) {
      clearReconnectSyncTimeout();
      setRealtimeState?.({ status: 'idle', text: '' });
    }
  }, [setRealtimeState, usingFallback]);

  useEffect(() => {
    if (usingFallback) return undefined;
    const since = lastStreamEventIdRef.current > 0 ? `?since=${lastStreamEventIdRef.current}` : '';
    const eventSource = new EventSource(`/api/realtime/stream${since}`);
    eventSourceRef.current = eventSource;

    const onStreamReady = (evt) => {
      const payload = parseStreamPayload(evt);
      if (!shouldHandleStreamEvent(evt)) return;
      const readyCount = streamReadyCountRef.current + 1;
      streamReadyCountRef.current = readyCount;
      const shouldRecover = readyCount > 1 || Boolean(payload?.resetRequired);
      if (payload?.resetRequired) {
        emitMessengerTelemetry({
          category: 'realtime',
          metric: 'reconnect',
          outcome: 'reset_required',
          value: Number(payload?.replayedCount || 0),
          details: { sinceId: payload?.sinceId || null },
        });
      }
      if (shouldRecover) {
        setRealtimeState?.({ status: 'syncing', text: 'Восстанавливаю события и обновляю чат…' });
        recoverRealtimeState({ resetRequired: Boolean(payload?.resetRequired) })
          .catch(() => null)
          .finally(() => setRealtimeState?.({ status: 'connected', text: 'Соединение восстановлено' }));
      } else {
        setRealtimeState?.({ status: 'connected', text: '' });
      }
    };

    const onSyncUnread = (evt) => {
      if (!shouldHandleStreamEvent(evt)) return;
      const payload = parseStreamPayload(evt);
      scheduleChatsRefresh(activeChatIdRef.current || null);
      if (payload?.incoming_requests != null) {
        loadRequests().catch(() => null);
      }
    };

    const onCreated = async (evt) => {
      if (!shouldHandleStreamEvent(evt)) return;
      const payload = parseStreamPayload(evt);
      if (!payload?.conversationId || !payload?.message) return;
      const currentChatId = activeChatIdRef.current;
      const decrypted = await decryptMessagePayload(payload.message).catch(() => payload.message);
      const incoming = normalizeMessage(decrypted);
      if (payload.conversationId === currentChatId) {
        setMessages((prev) => mergeMessages(prev, [incoming], 'append'));
        if (incoming.direction === 'incoming') {
          requestMarkConversationRead(payload.conversationId, { immediate: true });
        }
      }
      scheduleChatsRefresh(payload.conversationId);
      loadRequests().catch(() => null);
    };

    const onUpdated = async (evt) => {
      if (!shouldHandleStreamEvent(evt)) return;
      const payload = parseStreamPayload(evt);
      const currentChatId = activeChatIdRef.current;
      if (payload?.conversationId === currentChatId && payload?.message) {
        const decrypted = await decryptMessagePayload(payload.message).catch(() => payload.message);
        setMessages((prev) => mergeMessages(prev, [decrypted], 'append'));
      }
      scheduleChatsRefresh(payload?.conversationId || null);
    };

    const onDeleted = (evt) => {
      if (!shouldHandleStreamEvent(evt)) return;
      const payload = parseStreamPayload(evt);
      const currentChatId = activeChatIdRef.current;
      if (payload?.conversationId === currentChatId) {
        setMessages((prev) => applyDeletedMessage(prev, payload));
      }
      scheduleChatsRefresh(payload?.conversationId || null);
    };

    const onRead = (evt) => {
      if (!shouldHandleStreamEvent(evt)) return;
      const payload = parseStreamPayload(evt);
      const currentChatId = activeChatIdRef.current;
      if (payload?.conversationId === currentChatId) {
        setMessages((prev) => applyReadReceipt(prev, payload));
      }
      scheduleChatsRefresh(payload?.conversationId || null);
    };

    const onRequestUpdated = (evt) => {
      if (!shouldHandleStreamEvent(evt)) return;
      const payload = parseStreamPayload(evt);
      const currentChatId = activeChatIdRef.current;
      if (payload?.conversationId === currentChatId && currentChatId) {
        loadMessages(currentChatId, { mode: 'replace' }).catch(() => null);
      }
      scheduleChatsRefresh(payload?.conversationId || null);
      loadRequests().catch(() => null);
    };

    const onPresenceChanged = (evt) => {
      if (!shouldHandleStreamEvent(evt)) return;
      const payload = parseStreamPayload(evt);
      const peerId = currentPeerIdRef.current;
      if (peerId && Number(payload?.userId) === Number(peerId)) {
        setPeerPresence(payload);
        if (payload?.isOnline === false) {
          clearPeerTypingTimeout();
          setPeerTyping(false);
        }
      }
    };

    const onTypingStarted = (evt) => {
      if (!shouldHandleStreamEvent(evt)) return;
      const payload = parseStreamPayload(evt);
      const peerId = currentPeerIdRef.current;
      const currentChatId = activeChatIdRef.current;
      if (payload?.conversationId === currentChatId && peerId && Number(payload?.userId) === Number(peerId)) {
        setPeerTyping(true);
        schedulePeerTypingExpiry(payload?.expiresAt || payload?.expires_at || null);
      }
    };

    const onTypingStopped = (evt) => {
      if (!shouldHandleStreamEvent(evt)) return;
      const payload = parseStreamPayload(evt);
      const peerId = currentPeerIdRef.current;
      const currentChatId = activeChatIdRef.current;
      if (payload?.conversationId === currentChatId && peerId && Number(payload?.userId) === Number(peerId)) {
        clearPeerTypingTimeout();
        setPeerTyping(false);
      }
    };

    const onCallUpdated = (evt) => {
      if (!shouldHandleStreamEvent(evt)) return;
      const payload = parseStreamPayload(evt);
      if (payload?.conversationId === activeChatIdRef.current) {
        setActiveCall(pickLiveCall(payload?.call));
        setCallClientStatus('Входящий звонок. Ожидаем ответа.');
        setCallClientError('');
      }
      if (payload?.conversationId) scheduleChatsRefresh(payload.conversationId);
    };

    const onCallInvite = (evt) => {
      if (!shouldHandleStreamEvent(evt)) return;
      const payload = parseStreamPayload(evt);
      if (payload?.conversationId === activeChatIdRef.current) {
        setActiveCall(pickLiveCall(payload?.call));
        setCallClientStatus('Входящий звонок. Ожидаем ответа.');
        setCallClientError('');
      }
      if (payload?.conversationId) scheduleChatsRefresh(payload.conversationId);
    };

    const onCallSignal = (evt) => {
      if (!shouldHandleStreamEvent(evt)) return;
      const payload = parseStreamPayload(evt);
      if (!payload?.callId || payload.callId !== activeCallIdRef.current) return;
      processIncomingCallSignal(payload).catch(() => null);
    };

    const onChatUpdated = (evt) => {
      if (!shouldHandleStreamEvent(evt)) return;
      const payload = parseStreamPayload(evt);
      scheduleChatsRefresh(payload?.conversationId || null);
      if (payload?.conversationId === activeChatIdRef.current && activeChatIdRef.current) {
        loadPinnedMessages(activeChatIdRef.current).catch(() => null);
      }
    };

    eventSource.addEventListener('stream.ready', onStreamReady);
    eventSource.addEventListener('sync.unread', onSyncUnread);
    eventSource.addEventListener('message.created', onCreated);
    eventSource.addEventListener('message.updated', onUpdated);
    eventSource.addEventListener('message.deleted', onDeleted);
    eventSource.addEventListener('message.read', onRead);
    eventSource.addEventListener('message_request.updated', onRequestUpdated);
    eventSource.addEventListener('presence.changed', onPresenceChanged);
    eventSource.addEventListener('typing.started', onTypingStarted);
    eventSource.addEventListener('typing.stopped', onTypingStopped);
    eventSource.addEventListener('call.updated', onCallUpdated);
    eventSource.addEventListener('call.invite', onCallInvite);
    eventSource.addEventListener('call.signal', onCallSignal);
    eventSource.addEventListener('chat.updated', onChatUpdated);
    eventSource.onopen = () => {
      clearReconnectSyncTimeout();
      const reconnectState = realtimeDisconnectStateRef.current;
      if (reconnectState.active) {
        emitMessengerTelemetry({
          category: 'realtime',
          metric: 'reconnect',
          outcome: 'recovered',
          durationMs: reconnectState.startedAt ? Date.now() - reconnectState.startedAt : null,
          details: { activeChatId: activeChatIdRef.current || null },
        });
        realtimeDisconnectStateRef.current = { active: false, startedAt: 0, lastAttemptAt: 0 };
        setRealtimeState?.({ status: 'connected', text: 'Соединение восстановлено' });
      } else {
        setRealtimeState?.({ status: 'connected', text: '' });
      }
      setErrorText((prev) => prev?.startsWith?.('Realtime') ? '' : prev);
    };
    eventSource.onerror = () => {
      const now = Date.now();
      const state = realtimeDisconnectStateRef.current;
      if (!state.active) {
        realtimeDisconnectStateRef.current = { active: true, startedAt: now, lastAttemptAt: now };
        setRealtimeState?.({ status: 'reconnecting', text: 'Соединение нестабильно. Пытаюсь переподключиться…' });
        emitMessengerTelemetry({ category: 'realtime', metric: 'reconnect', outcome: 'attempt', details: { activeChatId: activeChatIdRef.current || null } });
        scheduleReconnectRecovery();
        return;
      }
      if (now - state.lastAttemptAt >= 10000) {
        realtimeDisconnectStateRef.current = { ...state, lastAttemptAt: now };
        setRealtimeState?.({ status: 'reconnecting', text: 'Повторяю подключение к realtime…' });
        emitMessengerTelemetry({ category: 'realtime', metric: 'reconnect', outcome: 'attempt', details: { activeChatId: activeChatIdRef.current || null } });
      }
    };

    return () => {
      eventSource.removeEventListener('stream.ready', onStreamReady);
      eventSource.removeEventListener('sync.unread', onSyncUnread);
      eventSource.removeEventListener('message.created', onCreated);
      eventSource.removeEventListener('message.updated', onUpdated);
      eventSource.removeEventListener('message.deleted', onDeleted);
      eventSource.removeEventListener('message.read', onRead);
      eventSource.removeEventListener('chat.updated', onChatUpdated);
      eventSource.removeEventListener('message_request.updated', onRequestUpdated);
      eventSource.removeEventListener('presence.changed', onPresenceChanged);
      eventSource.removeEventListener('typing.started', onTypingStarted);
      eventSource.removeEventListener('typing.stopped', onTypingStopped);
      eventSource.removeEventListener('call.updated', onCallUpdated);
      eventSource.removeEventListener('call.invite', onCallInvite);
      eventSource.removeEventListener('call.signal', onCallSignal);
      clearReconnectSyncTimeout();
      eventSource.close();
      eventSourceRef.current = null;
      setRealtimeState?.({ status: 'idle', text: '' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingFallback, sidebarMode]);
}

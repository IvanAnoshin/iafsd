'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRecorderAndMedia } from './hooks/useRecorderAndMedia';
import { useCallRuntime } from './hooks/useCallRuntime';
import { useConversationRuntime } from './hooks/useConversationRuntime';
import { useMessengerTelemetry } from './hooks/useMessengerTelemetry';
import { useMessageSearch } from './hooks/useMessageSearch';
import { useMessageSelection } from './hooks/useMessageSelection';
import { useChatSidebarRuntime } from './hooks/useChatSidebarRuntime';
import { useMessageActionsRuntime } from './hooks/useMessageActionsRuntime';
import { useMessageComposerRuntime } from './hooks/useMessageComposerRuntime';
import { useRealtimeChatRuntime } from './hooks/useRealtimeChatRuntime';
import { useConversationCallControls } from './hooks/useConversationCallControls';
import { useMessengerOverlayRuntime } from './hooks/useMessengerOverlayRuntime';
import ChatSidebar from './components/ChatSidebar';
import ChatConversationWorkspace from './components/ChatConversationWorkspace';
import { MAX_BATCH_MESSAGE_SELECTION, canBatchSelectMessage, mediaPreviewLabel } from './components/chatViewPrimitives';
import { readPageCache, writePageCache } from '@/lib/page-cache';
import PostAuthBottomNav from '../../components/PostAuthBottomNav';
import { mapStoryToRailItem } from '@/lib/stories-foundation';
import { registerCurrentE2EEDevice } from '@/lib/e2ee-client';

const fallbackChatsSeed = [
  {
    id: 'fallback-anna',
    name: 'Анна Смирнова',
    status: 'в сети',
    preview: 'Сейчас чат выглядит уже как рабочий мессенджер.',
    time: '14:20',
    unread: 0,
    initials: 'АС',
    tone: 'violet',
    draft_text: '',
    messages: [
      { id: 'f1', type: 'divider', label: 'Сегодня' },
      { id: 'f2', direction: 'incoming', text: 'Если backend чата ещё не поднялся, страница не должна разваливаться.', time: '14:12' },
      { id: 'f3', direction: 'outgoing', text: 'Да, поэтому тут есть запасной режим отображения.', time: '14:20', state: 'read' },
    ],
  },
];

const CHAT_CACHE_KEY = 'page:chat';
const CHAT_CACHE_TTL = 2 * 60 * 1000;
function formatPresenceStatus(presence, fallback = 'Ожидание данных') {
  if (!presence) return fallback;
  if (presence.isOnline) return 'в сети';
  const raw = presence.lastSeenAt || presence.last_seen_at || presence.updatedAt || presence.updated_at || null;
  const ts = raw ? new Date(raw).getTime() : 0;
  if (!ts || Number.isNaN(ts)) return fallback;
  const diffMs = Math.max(0, Date.now() - ts);
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes <= 1) return 'был(а) только что';
  if (diffMinutes < 60) return `был(а) ${diffMinutes} мин назад`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `был(а) ${diffHours} ч назад`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `был(а) ${diffDays} дн назад`;
  return fallback || 'не в сети';
}

function canAutoMarkConversationRead({ activeChatId, showList }) {
  if (!activeChatId) return false;
  if (showList) return false;
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible' && (typeof document.hasFocus !== 'function' || document.hasFocus());
}

function makeClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cloneMediaPayload(media) {
  return media ? JSON.parse(JSON.stringify(media)) : null;
}

function buildChatUploadCacheKey(file, kind = '', metadata = {}) {
  if (!file) return '';
  const normalizedKind = String(kind || inferUploadKind(file) || 'file').trim().toLowerCase();
  const duration = Number(metadata?.durationSec || metadata?.duration || metadata?.durationSeconds || 0) || 0;
  return [
    normalizedKind,
    String(file.name || '').trim().toLowerCase(),
    String(file.type || '').trim().toLowerCase(),
    Number(file.size || 0) || 0,
    Number(file.lastModified || 0) || 0,
    duration,
  ].join('::');
}

function readJsonSafe(response) {
  return response.json().catch(() => null);
}

function describeMediaPermissionError(error, options = {}) {
  const wantsVideo = Boolean(options.video);
  const mode = options.mode || 'call';
  const name = String(error?.name || '');
  const message = String(error?.message || '');
  const denied = name === 'NotAllowedError' || /permission denied|denied permission|notallowed/i.test(message);
  const unavailable = name === 'NotFoundError' || /requested device not found|not found/i.test(message);
  if (denied) {
    if (mode === 'recorder') return wantsVideo ? 'Разрешите доступ к камере и микрофону для записи видеокружка.' : 'Разрешите доступ к микрофону для записи голосового сообщения.';
    if (mode === 'probe') return wantsVideo ? 'Браузер не дал доступ к камере и микрофону.' : 'Браузер не дал доступ к микрофону.';
    return wantsVideo ? 'Разрешите доступ к камере и микрофону для звонка.' : 'Разрешите доступ к микрофону для звонка.';
  }
  if (unavailable) {
    if (mode === 'recorder') return wantsVideo ? 'Камера не найдена или недоступна. Проверьте настройки устройства и браузера.' : 'Микрофон не найден. Проверьте подключение устройства.';
    if (mode === 'probe') return wantsVideo ? 'Браузер не нашёл камеру для проверки видеорежима.' : 'Браузер не нашёл микрофон для проверки.';
    return wantsVideo ? 'Камера не найдена или недоступна. Проверьте настройки устройства и браузера.' : 'Микрофон не найден. Проверьте подключение устройства.';
  }
  return error?.message || (mode === 'recorder' ? 'Не удалось получить доступ к микрофону или камере.' : mode === 'probe' ? 'Не удалось выполнить проверку устройств.' : 'Не удалось получить доступ к устройствам для звонка.');
}

function getVideoRequirementError(diagnostics, mode = 'video') {
  if (!diagnostics) return '';
  const hasMic = (diagnostics.audioInputCount || 0) > 0;
  const hasCamera = (diagnostics.videoInputCount || 0) > 0;
  if (!hasCamera && !hasMic) {
    return mode === 'call'
      ? 'Камера и микрофон не найдены. Видеозвонок сейчас недоступен.'
      : 'Камера и микрофон не найдены. Видеокружок сейчас недоступен.';
  }
  if (!hasCamera) {
    return mode === 'call'
      ? 'Камера не найдена. Видеозвонок сейчас недоступен.'
      : 'Камера не найдена. Видеокружок сейчас недоступен.';
  }
  if (!hasMic) {
    return mode === 'call'
      ? 'Микрофон не найден. Видеозвонок сейчас недоступен.'
      : 'Микрофон не найден. Видеокружок сейчас недоступен.';
  }
  return '';
}


async function requestMediaInput({ audio = false, video = false } = {}) {
  if (!navigator?.mediaDevices?.getUserMedia) {
    throw new Error('Браузер не поддерживает доступ к микрофону или камере.');
  }

  const wantsAudio = Boolean(audio);
  const wantsVideo = Boolean(video);
  if (!wantsAudio && !wantsVideo) {
    return new MediaStream();
  }

  return navigator.mediaDevices.getUserMedia({
    audio: wantsAudio,
    video: wantsVideo
      ? {
          width: { ideal: 960 },
          height: { ideal: 720 },
        }
      : false,
  });
}


function inferUploadKind(file) {
  const mime = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return name.includes('note') || name.includes('circle') ? 'video_note' : 'video';
  if (mime.startsWith('audio/')) return 'voice';
  return 'file';
}

function pickLiveCall(call) {
  return call && ['ringing', 'active'].includes(call.status) ? call : null;
}

function normalizeMessage(item) {
  return {
    ...item,
    type: item.type || 'text',
    direction: item.direction || (item.is_mine ? 'outgoing' : 'incoming'),
    state: item.direction === 'outgoing' || item.is_mine ? (item.state || 'sent') : null,
  };
}

function formatTimelineDateLabel(message) {
  const date = new Date(message?.created_at || message?.updated_at || Date.now());
  return Number.isNaN(date.getTime())
    ? 'Сегодня'
    : date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });
}

function isClusterableMediaMessage(message) {
  if (!message) return false;
  if (!['image', 'video'].includes(String(message.type || '').toLowerCase())) return false;
  if (!message.media?.url) return false;
  if (message.deleted) return false;
  if (String(message.text || '').trim()) return false;
  return true;
}

function mediaGroupToken(message) {
  return String(
    message?.metadata?.media_group_id
      || message?.metadata?.group_id
      || message?.metadata?.media?.group_id
      || ''
  ).trim();
}

function shouldJoinMediaCluster(left, right) {
  if (!isClusterableMediaMessage(left) || !isClusterableMediaMessage(right)) return false;
  if ((left.sender?.id || null) !== (right.sender?.id || null)) return false;
  if ((left.direction || '') !== (right.direction || '')) return false;
  const leftToken = mediaGroupToken(left);
  const rightToken = mediaGroupToken(right);
  if (leftToken && rightToken) return leftToken === rightToken;
  const leftTime = new Date(left.created_at || left.updated_at || 0).getTime();
  const rightTime = new Date(right.created_at || right.updated_at || 0).getTime();
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return false;
  return Math.abs(rightTime - leftTime) <= 180000;
}

function buildMediaCluster(messages, startIndex) {
  const items = [messages[startIndex]];
  let cursor = startIndex + 1;
  while (cursor < messages.length && shouldJoinMediaCluster(items[items.length - 1], messages[cursor])) {
    items.push(messages[cursor]);
    cursor += 1;
  }
  return {
    nextIndex: cursor,
    cluster: items.length > 1 ? {
      id: `cluster-${items.map((item) => item.id || item.client_id).join('-')}`,
      kind: 'media-cluster',
      direction: items[0].direction,
      created_at: items[0].created_at,
      updated_at: items[items.length - 1].updated_at || items[items.length - 1].created_at,
      sender: items[0].sender,
      items,
    } : null,
  };
}

function groupMessages(messages, options = {}) {
  const result = [];
  let lastLabel = null;
  const enableMediaGrouping = options?.mediaGrouping !== false;
  const normalized = messages.map(normalizeMessage).filter((message) => !message?.deleted);
  const unreadCount = Math.max(0, Math.min(Number(options?.unreadCount || 0) || 0, normalized.length));
  const unreadStartIndex = unreadCount > 0 ? Math.max(0, normalized.length - unreadCount) : -1;

  for (let index = 0; index < normalized.length; index += 1) {
    const message = normalized[index];
    const label = formatTimelineDateLabel(message);

    if (label !== lastLabel) {
      result.push({ id: `divider-${label}`, kind: 'divider', label, variant: 'date' });
      lastLabel = label;
    }

    if (unreadStartIndex >= 0 && index === unreadStartIndex) {
      result.push({ id: `divider-unread-${message.id || message.client_id || index}`, kind: 'divider', label: 'Непрочитанные', variant: 'unread', target_message_id: message.id || message.client_id || null });
    }

    if (enableMediaGrouping) {
      const { nextIndex, cluster } = buildMediaCluster(normalized, index);
      if (cluster) {
        result.push(cluster);
        index = nextIndex - 1;
        continue;
      }
    }

    result.push({ ...message, kind: 'message' });
  }

  return result;
}


function applyQuickReactionOptimistic(message, emoji = '❤️') {
  const targetEmoji = String(emoji || '❤️').trim() || '❤️';
  const reactions = Array.isArray(message?.reactions) ? [...message.reactions] : [];
  const index = reactions.findIndex((entry) => entry?.emoji === targetEmoji);
  if (index >= 0) {
    const current = reactions[index];
    if (current?.reacted_by_me) {
      const nextCount = Math.max(0, Number(current.count || 1) - 1);
      if (nextCount > 0) reactions[index] = { ...current, count: nextCount, reacted_by_me: false };
      else reactions.splice(index, 1);
    } else {
      reactions[index] = { ...current, count: Number(current.count || 0) + 1, reacted_by_me: true };
    }
  } else {
    reactions.push({ emoji: targetEmoji, count: 1, reacted_by_me: true });
  }
  return { ...message, reactions };
}

function mergeMessages(current, incoming, mode = 'append') {
  const list = [];
  const source = mode === 'prepend' ? [...incoming, ...current] : [...current, ...incoming];
  for (const raw of source) {
    const item = normalizeMessage(raw);
    const itemMediaUrl = String(item?.media?.url || '').trim();
    const itemCreatedAt = new Date(item.created_at || item.updated_at || 0).getTime();
    const index = list.findIndex((existing) => {
      if (item.id && existing.id && item.id === existing.id) return true;
      if (item.client_id && existing.client_id && item.client_id === existing.client_id) return true;
      const existingCreatedAt = new Date(existing.created_at || existing.updated_at || 0).getTime();
      const closeInTime = Number.isFinite(itemCreatedAt) && Number.isFinite(existingCreatedAt)
        ? Math.abs(itemCreatedAt - existingCreatedAt) <= 15000
        : false;
      const sameOptimisticPayload = closeInTime
        && (item.is_mine || item.direction === 'outgoing')
        && (existing.is_mine || existing.direction === 'outgoing')
        && String(item.type || 'text') === String(existing.type || 'text')
        && String(item.text || '') === String(existing.text || '')
        && itemMediaUrl
        && itemMediaUrl === String(existing?.media?.url || '').trim()
        && (String(item.id || '').startsWith('local:') || String(existing.id || '').startsWith('local:'));
      const sameOptimisticText = closeInTime
        && (item.is_mine || item.direction === 'outgoing')
        && (existing.is_mine || existing.direction === 'outgoing')
        && String(item.type || 'text') === String(existing.type || 'text')
        && !itemMediaUrl
        && !String(existing?.media?.url || '').trim()
        && String(item.text || '').trim()
        && String(item.text || '').trim() === String(existing.text || '').trim()
        && (
          String(item.id || '').startsWith('local:')
          || String(existing.id || '').startsWith('local:')
          || ['sending', 'failed'].includes(String(item.state || '').toLowerCase())
          || ['sending', 'failed'].includes(String(existing.state || '').toLowerCase())
        );
      return sameOptimisticPayload || sameOptimisticText;
    });
    if (index >= 0) {
      list[index] = { ...list[index], ...item };
    } else {
      list.push(item);
    }
  }
  const cleaned = list.filter((item) => !item?.deleted);
  const knownIds = new Set();
  cleaned.forEach((item) => {
    if (item?.id) knownIds.add(String(item.id));
    if (item?.client_id) knownIds.add(String(item.client_id));
  });
  return cleaned
    .map((item) => {
      const replyId = item?.reply_to?.id ? String(item.reply_to.id) : '';
      if (replyId && !knownIds.has(replyId)) {
        return { ...item, reply_to: null };
      }
      return item;
    })
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}


async function inspectVideoDevices() {
  if (!navigator?.mediaDevices?.enumerateDevices) {
    return {
      hasCamera: true,
      hasMicrophone: true,
      audioInputCount: 0,
      videoInputCount: 0,
      permissionCamera: 'unknown',
      permissionMicrophone: 'unknown',
    };
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputCount = devices.filter((device) => device.kind === 'audioinput').length;
  const videoInputCount = devices.filter((device) => device.kind === 'videoinput').length;
  const hasCamera = videoInputCount > 0;
  const hasMicrophone = audioInputCount > 0;
  let permissionCamera = 'unknown';
  let permissionMicrophone = 'unknown';
  try {
    const result = await navigator.permissions.query({ name: 'camera' });
    permissionCamera = result?.state || 'unknown';
  } catch {
    permissionCamera = 'unknown';
  }
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });
    permissionMicrophone = result?.state || 'unknown';
  } catch {
    permissionMicrophone = 'unknown';
  }
  return { hasCamera, hasMicrophone, audioInputCount, videoInputCount, permissionCamera, permissionMicrophone };
}

export default function ChatPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isDebugChat, setIsDebugChat] = useState(false);
  const [directTargetUserId, setDirectTargetUserId] = useState(null);
  const [directMomentContext, setDirectMomentContext] = useState(null);

  const initialCacheRef = useRef(null);
  const pageRootRef = useRef(null);
  const [showList, setShowList] = useState(true);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [chats, setChats] = useState([]);
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [focusedMessageId, setFocusedMessageId] = useState(null);
  const [replyDraftPulseKey, setReplyDraftPulseKey] = useState(0);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [composerMode, setComposerMode] = useState('send');
  const [errorText, setErrorText] = useState('');
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [realtimeState, setRealtimeState] = useState({ status: 'idle', text: '' });
  const [usingFallback, setUsingFallback] = useState(false);
  const [chatMomentItems, setChatMomentItems] = useState([]);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [overlayGuardActive, setOverlayGuardActive] = useState(false);
  const [keyboardViewportState, setKeyboardViewportState] = useState({ open: false, offset: 0, height: 0 });
  const disableMessageActions = overlayGuardActive;

  useEffect(() => {
    if (!errorText) {
      setNoticeVisible(false);
      return undefined;
    }
    setNoticeVisible(true);
    if (isDebugChat || usingFallback) return undefined;
    const timer = window.setTimeout(() => {
      setNoticeVisible(false);
      window.setTimeout(() => setErrorText(''), 180);
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [errorText, isDebugChat, usingFallback]);

  const initializedDirectRef = useRef(false);
  const timelineRef = useRef(null);
  const conversationSearchBridgeRef = useRef({ setFocusedMessageId: () => {}, setError: () => {} });
  const focusedMessageTimeoutRef = useRef(null);
  const presenceIntervalRef = useRef(null);
  const overlayGuardTimerRef = useRef(null);
  const timelineScrollStateRef = useRef({
    chatId: null,
    firstKey: '',
    lastKey: '',
    count: 0,
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 0,
    nearBottom: true,
  });

  useLayoutEffect(() => {
    const root = pageRootRef.current;
    if (!root || typeof window === 'undefined') return undefined;

    const syncViewport = () => {
      const visualViewport = window.visualViewport;
      const viewportHeight = Math.max(0, Math.round(visualViewport?.height || window.innerHeight || 0));
      const keyboardOffset = visualViewport
        ? Math.max(0, Math.round((window.innerHeight || 0) - visualViewport.height - (visualViewport.offsetTop || 0)))
        : 0;
      const keyboardOpen = keyboardOffset > 84;
      root.style.setProperty('--chatw-viewport-height', `${viewportHeight || Math.round(window.innerHeight || 0)}px`);
      root.style.setProperty('--chatw-keyboard-offset', `${keyboardOffset}px`);
      root.dataset.keyboardOpen = keyboardOpen ? 'true' : 'false';
      setKeyboardViewportState((prev) => (
        prev.open === keyboardOpen && prev.offset === keyboardOffset && prev.height === viewportHeight
          ? prev
          : { open: keyboardOpen, offset: keyboardOffset, height: viewportHeight }
      ));
    };

    syncViewport();
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', syncViewport);
    visualViewport?.addEventListener('scroll', syncViewport);
    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', syncViewport);

    return () => {
      visualViewport?.removeEventListener('resize', syncViewport);
      visualViewport?.removeEventListener('scroll', syncViewport);
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
    };
  }, []);

  const { emitMessengerTelemetry } = useMessengerTelemetry();

  const emitMediaDeviceErrorTelemetry = useCallback((error, details = {}) => {
    emitMessengerTelemetry({
      category: 'call',
      metric: 'media_device',
      outcome: 'error',
      details: {
        name: String(error?.name || ''),
        message: String(error?.message || ''),
        ...details,
      },
    });
  }, [emitMessengerTelemetry]);

  const armOverlayGuard = useCallback(() => {
    if (overlayGuardTimerRef.current) {
      window.clearTimeout(overlayGuardTimerRef.current);
      overlayGuardTimerRef.current = null;
    }
    setOverlayGuardActive(true);
    overlayGuardTimerRef.current = window.setTimeout(() => {
      setOverlayGuardActive(false);
      overlayGuardTimerRef.current = null;
    }, 900);
  }, []);

  const {
    activeCall,
    setActiveCall,
    callClientStatus,
    setCallClientStatus,
    callClientError,
    setCallClientError,
    localCallReady,
    remoteCallReady,
    localCallVideoRef,
    remoteCallVideoRef,
    remoteCallAudioRef,
    activeCallIdRef,
    callViewer,
    hasLiveCall,
    ensureLocalCallStream,
    processIncomingCallSignal,
    ensureCallConnection,
    callBannerTitle,
    callBannerText,
  } = useCallRuntime({
    usingFallback,
    readJsonSafe,
    requestMediaInput,
    emitMessengerTelemetry,
    normalizeActiveCall: pickLiveCall,
  });

  const {
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
  } = useConversationRuntime({
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
  });

  const {
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
  } = useChatSidebarRuntime({
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
  });

  const activeChatUnreadCount = Number(activeChat?.unread || 0) || 0;
  const activeChatForMedia = useMemo(() => chats.find((chat) => chat.id === activeChatId) || null, [activeChatId, chats]);
  const conversationRequestState = conversationMeta?.request_state || activeChatForMedia?.request_state || null;
  const composeBlockedForMedia = ['blocked', 'incoming', 'outgoing', 'rejected'].includes(String(conversationRequestState || '').trim().toLowerCase());

  const {
    pendingAttachment,
    pendingAttachments,
    setPendingAttachment,
    setPendingAttachments,
    pendingAttachmentRef,
    pendingAttachmentsRef,
    uploadingAttachment,
    setUploadingAttachment,
    attachmentSheetOpen,
    setAttachmentSheetOpen,
    fileInputRef,
    mediaProbeState,
    mediaDiagnostics,
    hasDetectedMicrophone,
    hasDetectedCamera,
    videoCallFallback,
    setVideoCallFallback,
    voiceRecorderState,
    dispatchVoiceRecorder,
    videoNoteState,
    dispatchVideoNote,
    videoNoteLiveRef,
    openAttachmentPicker,
    launchAttachmentPicker,
    clearPendingAttachment,
    markPendingAttachmentCommitted,
    retryPendingAttachment,
    handleAttachmentChange,
    resetAttachmentUiState,
    runMediaProbe,
    refreshMediaProbeDiagnostics,
    closeMediaProbe,
    applyVideoDiagnostics,
    rerunVideoAvailabilityCheck,
    cleanupVoiceRecorderResources,
    openVoiceRecorder,
    stopVoiceRecording,
    closeVoiceRecorder,
    retakeVoiceRecording,
    markUploadedMediaCommitted,
    releaseChatMediaUpload,
    queueChatMediaUpload,
    cleanupVideoNoteResources,
    openVideoNoteRecorder,
    startVideoNoteRecording,
    stopVideoNoteRecording,
    closeVideoNoteRecorder,
    retakeVideoNote,
  } = useRecorderAndMedia({
    activeChatId,
    usingFallback,
    composerMode,
    composeBlockedByRequest: composeBlockedForMedia,
    setErrorText,
    requestMediaInput,
    readJsonSafe,
    buildChatUploadCacheKey,
    cloneMediaPayload,
    inferUploadKind,
    makeClientId,
    describeMediaPermissionError,
  });

  const composeBlockedByRequest = composeBlockedForMedia;
  const pendingAttachmentItems = Array.isArray(pendingAttachments) ? pendingAttachments : [];
  const readyAttachmentCount = pendingAttachmentItems.filter((item) => String(item?.status || '').trim().toLowerCase() === 'ready').length;
  const failedAttachmentCount = pendingAttachmentItems.filter((item) => String(item?.status || '').trim().toLowerCase() === 'failed').length;
  const hasReadyAttachment = readyAttachmentCount > 0;
  const hasFailedAttachment = failedAttachmentCount > 0;
  const isAttachmentUploading = uploadingAttachment || pendingAttachmentItems.some((item) => String(item?.status || '').trim().toLowerCase() === 'uploading');

  const {
    callActionLoading,
    callStartDisabled,
    videoCallFallbackVisible,
    canToggleCallMic,
    canToggleCallCamera,
    startConversationCall,
    startAudioFallbackCall,
    dismissVideoCallFallback,
    handleCallAction,
  } = useConversationCallControls({
    activeChatId,
    activeCall,
    callViewer,
    usingFallback,
    composeBlockedByRequest,
    readJsonSafe,
    pickLiveCall,
    emitMessengerTelemetry,
    emitMediaDeviceErrorTelemetry,
    describeMediaPermissionError,
    inspectVideoDevices,
    getVideoRequirementError,
    ensureLocalCallStream,
    setActiveCall,
    ensureCallConnection,
    scheduleChatsRefresh,
    setErrorText,
    videoCallFallback,
    setVideoCallFallback,
  });

  const {
    sending,
    draftState,
    sendOptimisticMessage,
    sendVoiceRecording,
    sendVideoNote,
    handleSend,
    composerSendBlocked,
  } = useMessageComposerRuntime({
    activeChat,
    activeChatId,
    message,
    composerMode,
    editingMessageId,
    replyingTo,
    usingFallback,
    composeBlockedByRequest,
    pendingAttachment,
    pendingAttachments: pendingAttachmentItems,
    markPendingAttachmentCommitted,
    hasReadyAttachment,
    hasFailedAttachment,
    isAttachmentUploading,
    voiceRecorderState,
    videoNoteState,
    draftSnapshotRef,
    readJsonSafe,
    mergeMessages,
    mediaPreviewLabel,
    makeClientId,
    queueChatMediaUpload,
    cleanupVoiceRecorderResources,
    cleanupVideoNoteResources,
    markUploadedMediaCommitted,
    resetAttachmentUiState,
    scheduleChatsRefresh,
    loadRequests,
    setMessages,
    setChats,
    setMessage,
    setErrorText,
    setSelectedMessageId,
    setEditingMessageId,
    setReplyingTo,
    setComposerMode,
    dispatchVoiceRecorder,
    dispatchVideoNote,
  });


  useEffect(() => {
    registerCurrentE2EEDevice().catch((error) => {
      console.error('e2ee device bootstrap failed', error);
    });
  }, []);

  useLayoutEffect(() => {
    const cachedState = readPageCache(CHAT_CACHE_KEY, CHAT_CACHE_TTL);
    initialCacheRef.current = cachedState;
    if (!cachedState) return;
    setShowList(cachedState.showList ?? true);
    setSearch(cachedState.search || '');
    setMessage(cachedState.message || '');
    setChats(Array.isArray(cachedState.chats) ? cachedState.chats : []);
    setActiveChatId(cachedState.activeChatId || null);
    setConversationMeta(cachedState.conversationMeta || null);
    setMessages(Array.isArray(cachedState.messages) ? cachedState.messages : []);
    setLoadingChats(!cachedState.chats);
    setUsingFallback(Boolean(cachedState.usingFallback));
    setNextCursor(cachedState.nextCursor || null);
    setHasMore(Boolean(cachedState.hasMore));
    setSidebarMode(cachedState.sidebarMode || 'chats');
    setRequests(cachedState.requests || { incoming: [], outgoing: [], count: 0 });
  }, []);




  const showTimelineSkeleton = Boolean(
    chatSwitchPending
    && activeChatId
    && chatSwitchTargetId === activeChatId
    && !chatViewCacheRef.current.get(String(activeChatId))
  );

  const shouldHidePinnedDuringSwitch = Boolean(
    chatSwitchPending
    && activeChatId
    && chatSwitchTargetId === activeChatId
    && !pinnedCacheByChatRef.current.get(String(activeChatId))
  );







  useEffect(() => {
    if (!chats.length && !messages.length && !requests.count && loadingChats) return;
    writePageCache(CHAT_CACHE_KEY, {
      showList,
      search,
      message,
      chats,
      activeChatId,
      conversationMeta,
      messages,
      usingFallback,
      nextCursor,
      hasMore,
      sidebarMode,
      requests,
    });
  }, [showList, search, message, chats, activeChatId, conversationMeta, messages, usingFallback, nextCursor, hasMore, sidebarMode, requests, loadingChats]);



  useEffect(() => {
    const params = searchParams;
    initializedDirectRef.current = false;
    armOverlayGuard();
    setIsDebugChat(params?.get('debug') === '1');
    const rawUser = params?.get('user');
    const parsedUser = Number(rawUser);
    setDirectTargetUserId(Number.isInteger(parsedUser) && parsedUser > 0 ? parsedUser : null);
    const momentId = String(params?.get('momentId') || '').trim();
    const momentTitle = String(params?.get('momentTitle') || '').trim();
    const momentAuthor = String(params?.get('momentAuthor') || '').trim();
    setDirectMomentContext(momentId ? { id: momentId, title: momentTitle || 'Момент', author: momentAuthor || 'Пользователь' } : null);
    setSelectedMessageId(null);
    setFocusedMessageId(null);
    setEditingMessageId(null);
    setReplyingTo(null);
    setComposerMode('send');
    setChatMenuOpen(false);
  }, [armOverlayGuard, searchParams]);


  useEffect(() => {
    let cancelled = false;
    const loadMomentRail = async () => {
      try {
        const response = await fetch('/api/stories?source=chat&limit=6', { cache: 'no-store' });
        const data = await readJsonSafe(response);
        if (!response.ok || cancelled) return;
        const items = Array.isArray(data?.items) ? data.items.map((story) => mapStoryToRailItem(story, 'chat')).filter(Boolean) : [];
        if (!cancelled) setChatMomentItems(items);
      } catch {
        if (!cancelled) setChatMomentItems([]);
      }
    };
    loadMomentRail();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (usingFallback) return undefined;
    const sendHeartbeat = () => {
      fetch('/api/presence/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'chat-page', conversation_id: activeChatId || null }),
      }).catch(() => null);
    };
    sendHeartbeat();
    presenceIntervalRef.current = setInterval(sendHeartbeat, 30_000);
    return () => clearInterval(presenceIntervalRef.current);
  }, [activeChatId, usingFallback]);

  useEffect(() => {
    if (!directTargetUserId) return;
    armOverlayGuard();
    setSelectedMessageId(null);
    setFocusedMessageId(null);
    setEditingMessageId(null);
    setReplyingTo(null);
    setComposerMode('send');
    setChatMenuOpen(false);
  }, [armOverlayGuard, directTargetUserId]);

  useEffect(() => {
    const user = directTargetUserId;
    if (!user || initializedDirectRef.current || usingFallback) return;
    initializedDirectRef.current = true;

    const run = async () => {
      try {
        const response = await fetch('/api/chats/direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_user_id: Number(user) }),
        });
        const payload = await readJsonSafe(response);
        if (!response.ok || !payload?.conversation) throw new Error(payload?.error || 'Не удалось открыть диалог.');
        await loadChats(payload.conversation.id);
        setShowList(false);
      } catch (error) {
        console.error('chat direct open failed', error);
        setErrorText(error?.message || 'Не удалось открыть диалог.');
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directTargetUserId, usingFallback]);






  useEffect(() => {
    if (!directMomentContext || !activeChatId) return;
    setReplyingTo({
      id: `moment-${directMomentContext.id}`,
      author: directMomentContext.author,
      text: `Момент · ${directMomentContext.title}`,
    });
    setComposerMode('send');
    setDirectMomentContext(null);
  }, [activeChatId, directMomentContext]);

  useEffect(() => {
    if (!overlayGuardActive) return;
    setSelectedMessageId(null);
    setFocusedMessageId(null);
    setEditingMessageId(null);
    setReplyingTo(null);
    setComposerMode('send');
    setChatMenuOpen(false);
  }, [overlayGuardActive]);

  useRealtimeChatRuntime({
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
  });

  const flashFocusedMessage = useCallback((messageId) => {
    if (!messageId) return;
    if (focusedMessageTimeoutRef.current) {
      window.clearTimeout(focusedMessageTimeoutRef.current);
      focusedMessageTimeoutRef.current = null;
    }
    setFocusedMessageId(messageId);
    focusedMessageTimeoutRef.current = window.setTimeout(() => {
      setFocusedMessageId((current) => (current === messageId ? null : current));
      focusedMessageTimeoutRef.current = null;
    }, 1650);
  }, []);

  useEffect(() => () => {
    if (focusedMessageTimeoutRef.current) {
      window.clearTimeout(focusedMessageTimeoutRef.current);
      focusedMessageTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (overlayGuardTimerRef.current) {
      window.clearTimeout(overlayGuardTimerRef.current);
      overlayGuardTimerRef.current = null;
    }
  }, []);

  const loadMessageContextIntoTimeline = useCallback(async (messageId, options = {}) => {
    if (!messageId || !activeChatId || usingFallback) return false;
    try {
      const response = await fetch(`/api/messages/${messageId}/context?before=12&after=12`, { cache: 'no-store' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload) throw new Error(payload?.error || 'Не удалось открыть сообщение.');
      if (payload.conversationId !== activeChatId) return false;
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (items.length) {
        setMessages((prev) => mergeMessages(prev, items, 'append'));
      }
      const targetId = payload.targetMessageId || messageId;
      conversationSearchBridgeRef.current.setFocusedMessageId(targetId);
      if (options.select) setSelectedMessageId(targetId);
      if (options.focus !== false) flashFocusedMessage(targetId);
      return true;
    } catch (error) {
      console.error('chat search context failed', error);
      conversationSearchBridgeRef.current.setError(error?.message || 'Не удалось открыть сообщение в контексте.');
      setErrorText(error?.message || 'Не удалось открыть сообщение в контексте.');
      return false;
    }
  }, [activeChatId, usingFallback, flashFocusedMessage]);



  const jumpToMessage = useCallback(async (messageId, options = {}) => {
    if (!messageId || !activeChatId || usingFallback) return false;
    const selectorId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(messageId)) : String(messageId);
    const targetSelector = `[data-message-id="${selectorId}"]`;
    const scrollToTarget = () => {
      const element = typeof document !== 'undefined' ? document.querySelector(targetSelector) : null;
      if (!element) return false;
      element.scrollIntoView({ behavior: options.instant ? 'auto' : 'smooth', block: 'center' });
      return true;
    };
    if (scrollToTarget()) {
      if (options.select) setSelectedMessageId(messageId);
      conversationSearchBridgeRef.current.setFocusedMessageId(messageId);
      if (options.focus !== false) flashFocusedMessage(messageId);
      return true;
    }
    const loaded = await loadMessageContextIntoTimeline(messageId, { select: Boolean(options.select), focus: options.focus !== false });
    if (!loaded) return false;
    window.setTimeout(() => {
      if (scrollToTarget() && options.focus !== false) flashFocusedMessage(messageId);
    }, 32);
    window.setTimeout(() => {
      if (scrollToTarget() && options.focus !== false) flashFocusedMessage(messageId);
    }, 180);
    return true;
  }, [activeChatId, usingFallback, loadMessageContextIntoTimeline, flashFocusedMessage]);


  const unreadAnchorMessageId = useMemo(() => {
    if (usingFallback || !activeChatUnreadCount || !messages.length) return null;
    const anchor = messages[Math.max(0, messages.length - activeChatUnreadCount)];
    return anchor?.id || anchor?.client_id || null;
  }, [activeChatUnreadCount, messages, usingFallback]);

  const jumpToLatest = useCallback(() => {
    const container = timelineRef.current;
    if (!container) return false;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    setSelectedMessageId(null);
    conversationSearchBridgeRef.current.setFocusedMessageId('');
    return true;
  }, []);

  const jumpToUnread = useCallback(() => {
    if (unreadAnchorMessageId) return jumpToMessage(unreadAnchorMessageId, { focus: true });
    return jumpToLatest();
  }, [jumpToLatest, jumpToMessage, unreadAnchorMessageId]);

  const handleQuickReact = useCallback(async (targetMessage, emoji = '❤️') => {
    const messageKey = targetMessage?.id || targetMessage?.client_id;
    if (!messageKey || usingFallback) return;
    setMessages((prev) => prev.map((item) => ((item.id || item.client_id) === messageKey ? applyQuickReactionOptimistic(item, emoji) : item)));
    try {
      const response = await fetch(`/api/messages/${messageKey}/reaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.message) throw new Error(payload?.error || 'Не удалось обновить реакцию.');
      setMessages((prev) => mergeMessages(prev, [payload.message], 'append'));
    } catch (error) {
      setMessages((prev) => prev.map((item) => ((item.id || item.client_id) === messageKey ? applyQuickReactionOptimistic(item, emoji) : item)));
      setErrorText(error?.message || 'Не удалось обновить реакцию.');
    }
  }, [usingFallback]);

  const handleReplyFromTimelineItem = useCallback((targetMessage) => {
    if (!targetMessage || targetMessage.deleted || targetMessage.state === 'sending') return;
    const author = targetMessage.is_mine ? 'Вы' : (targetMessage.sender?.name || 'Пользователь');
    const previewText = targetMessage.forwarded_from?.preview_text
      || targetMessage.text
      || targetMessage.preview_text
      || mediaPreviewLabel(targetMessage.type, targetMessage.media)
      || 'Сообщение';
    setReplyingTo({
      id: targetMessage.id,
      author,
      text: previewText,
    });
    setReplyDraftPulseKey((value) => value + 1);
    setComposerMode('send');
    setEditingMessageId(null);
    setSelectedMessageId(null);
  }, [setComposerMode, setEditingMessageId, setReplyingTo]);

  const openConversationFromSearchResult = useCallback((result) => {
    if (!result?.conversation_id) return;
    setConversationMeta(null);
    setMessages([]);
    setActiveChatId(String(result.conversation_id));
    setShowList(false);
    setSelectedMessageId(null);
    setEditingMessageId(null);
    setReplyingTo(null);
    setComposerMode('send');
    setChatMenuOpen(false);
  }, [setActiveChatId]);

  const {
    conversationSearchInputRef,
    conversationSearchOpen,
    setConversationSearchQuery,
    conversationSearchQuery,
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
  } = useMessageSearch({
    activeChatId,
    sidebarMode,
    searchQuery: search,
    usingFallback,
    messages,
    readJsonSafe,
    mergeMessages,
    setMessages,
    setErrorText,
    loadMessageContextIntoTimeline,
    onOpenConversationResult: openConversationFromSearchResult,
  });

  conversationSearchBridgeRef.current.setFocusedMessageId = setConversationSearchFocusedMessageId;
  conversationSearchBridgeRef.current.setError = setConversationSearchError;

  const selectedMessage = useMemo(() => messages.find((item) => item.id === selectedMessageId || item.client_id === selectedMessageId) || null, [messages, selectedMessageId]);

  const {
    interactionMode,
    forwardSheetOpen,
    setForwardTargetsQuery,
    forwardTargetsQuery,
    forwardSelectedChatIds,
    forwardComment,
    setForwardComment,
    forwardSubmitting,
    messageSelectionMode,
    selectedMessageIds,
    messageBatchActionLoading,
    messageSelectionNotice,
    selectedMessages,
    selectableLoadedMessages,
    selectableLoadedMessageIds,
    hasMoreSelectableLoaded,
    allLoadedSelectableChosen,
    selectedForwardableMessages,
    selectedSavableMessages,
    selectedUnsavableMessages,
    selectedDeletableMessages,
    forwardSourceMessages,
    selectedMessagePreviewItems,
    selectedMessageActionText,
    forwardTargetChats,
    toggleForwardChatSelection,
    toggleMessageSelection,
    beginMultiMessageSelection,
    selectAllLoadedMessages,
    clearMessageSelection,
    openForwardSheet,
    closeForwardSheet,
    handleForwardSelectedMessage,
    handleBatchToggleSaveSelectedMessages,
    handleBatchDeleteSelectedMessages,
  } = useMessageSelection({
    activeChatId,
    activeChat,
    chats,
    messages,
    selectedMessage,
    editingMessageId,
    replyingTo,
    usingFallback,
    maxBatchSelection: MAX_BATCH_MESSAGE_SELECTION,
    canBatchSelectMessage,
    mediaPreviewLabel,
    readJsonSafe,
    mergeMessages,
    setMessages,
    setSelectedMessageId,
    setComposerMode,
    setEditingMessageId,
    setReplyingTo,
    setErrorText,
    scheduleChatsRefresh,
    releaseChatMediaUpload,
  });
  const timelineItems = useMemo(() => {
    if (usingFallback) return activeChat?.messages || [];
    return groupMessages(messages, {
      unreadCount: activeChatUnreadCount,
      mediaGrouping: !messageSelectionMode,
    });
  }, [activeChat, activeChatUnreadCount, messageSelectionMode, messages, usingFallback]);


  const {
    selectedMessagePreviewText,
    messageActionLoading,
    closeSelectedMessage,
    beginEditMessage,
    beginReplyMessage,
    handleCopyMessage,
    handleToggleSaveMessage,
    handleReportSelectedMessage,
    handleTogglePinMessage,
    handleDeleteMessage,
    retryFailedMessage,
    dismissFailedMessage,
    handleRetryMessage,
    cancelComposerAction,
  } = useMessageActionsRuntime({
    activeChatId,
    activeChat,
    messages,
    selectedMessageId,
    conversationMeta,
    usingFallback,
    message,
    editingMessageId,
    replyingTo,
    draftSnapshotRef,
    mediaPreviewLabel,
    readJsonSafe,
    mergeMessages,
    applySavedMessageMutation,
    loadRequests,
    loadPinnedMessages,
    scheduleChatsRefresh,
    releaseChatMediaUpload,
    sendOptimisticMessage,
    setMessages,
    setMessage,
    setChats,
    setSelectedMessageId,
    setConversationMeta,
    setEditingMessageId,
    setReplyingTo,
    setComposerMode,
    setErrorText,
  });


  useEffect(() => {
    if (!messageSelectionMode) return;
    if (selectedMessageId) setSelectedMessageId(null);
  }, [messageSelectionMode, selectedMessageId, setSelectedMessageId]);

  useEffect(() => {
    if (!selectedMessageId) return;
    if (selectedMessage) return;
    setSelectedMessageId(null);
  }, [selectedMessage, selectedMessageId, setSelectedMessageId]);

  const {
    pinnedPanelOpen,
    openPinnedPanel,
    closePinnedPanel,
    activePinnedEntry,
    openPinnedMessage,
    stepPinnedMessage,
    toggleChatMenu,
    chatMenuWrapRef,
  } = useMessengerOverlayRuntime({
    activeChatId,
    chatMenuOpen,
    setChatMenuOpen,
    pinnedMessages,
    pinnedCurrentIndex,
    setPinnedCurrentIndex,
    loadMessageContextIntoTimeline,
    attachmentSheetOpen,
    setAttachmentSheetOpen,
    forwardSheetOpen,
    closeForwardSheet,
    forwardSubmitting,
  });


  const lastOverlayChatIdRef = useRef(null);

  useEffect(() => {
    if (!showList) return;
    setSelectedMessageId(null);
    setFocusedMessageId(null);
    setEditingMessageId(null);
    setReplyingTo(null);
    setComposerMode('send');
    setChatMenuOpen(false);
    setAttachmentSheetOpen(false);
    closeForwardSheet();
    closePinnedPanel();
  }, [showList, closeForwardSheet, closePinnedPanel, setAttachmentSheetOpen]);

  useEffect(() => {
    const handlePageHide = () => {
      setSelectedMessageId(null);
      setFocusedMessageId(null);
      setEditingMessageId(null);
      setReplyingTo(null);
      setComposerMode('send');
      setChatMenuOpen(false);
      setAttachmentSheetOpen(false);
      closeForwardSheet();
      closePinnedPanel();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [closeForwardSheet, closePinnedPanel, setAttachmentSheetOpen]);

  useEffect(() => {
    if (!activeChatId) {
      lastOverlayChatIdRef.current = null;
      return;
    }
    if (lastOverlayChatIdRef.current === null) {
      lastOverlayChatIdRef.current = activeChatId;
      return;
    }
    if (lastOverlayChatIdRef.current === activeChatId) return;
    lastOverlayChatIdRef.current = activeChatId;
    setSelectedMessageId(null);
    setFocusedMessageId(null);
    setEditingMessageId(null);
    setReplyingTo(null);
    setComposerMode('send');
    setChatMenuOpen(false);
    setAttachmentSheetOpen(false);
    closeForwardSheet();
    closePinnedPanel();
  }, [activeChatId, closeForwardSheet, closePinnedPanel, setAttachmentSheetOpen]);

  useEffect(() => {
    if (!overlayGuardActive) return;
    if (selectedMessageId) setSelectedMessageId(null);
  }, [overlayGuardActive, selectedMessageId, setSelectedMessageId]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (selectedMessageId) {
        setSelectedMessageId(null);
        return;
      }
      if (forwardSheetOpen) {
        closeForwardSheet();
        return;
      }
      if (pinnedPanelOpen) {
        closePinnedPanel();
        return;
      }
      if (attachmentSheetOpen) {
        setAttachmentSheetOpen(false);
        return;
      }
      if (chatMenuOpen) {
        setChatMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [attachmentSheetOpen, chatMenuOpen, closeForwardSheet, closePinnedPanel, forwardSheetOpen, pinnedPanelOpen, selectedMessageId, setAttachmentSheetOpen, setChatMenuOpen, setSelectedMessageId]);

  useEffect(() => {
    const hasModalOverlay = Boolean(selectedMessageId || forwardSheetOpen || pinnedPanelOpen || attachmentSheetOpen);
    if (!hasModalOverlay) return undefined;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [attachmentSheetOpen, forwardSheetOpen, pinnedPanelOpen, selectedMessageId]);




  const toggleChatPreference = async (type, enabled) => {
    if (!activeChatId || usingFallback) return;
    try {
      const response = await fetch(`/api/chats/${activeChatId}/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.conversation) throw new Error(payload?.error || 'Не удалось обновить настройки диалога.');
      const nextConversation = payload.conversation;
      setConversationMeta((prev) => prev ? { ...prev, ...nextConversation } : nextConversation);
      setChats((prev) => {
        const hasCurrent = prev.some((chat) => chat.id === nextConversation.id);
        const mapped = prev
          .map((chat) => chat.id === nextConversation.id ? { ...chat, ...nextConversation } : chat)
          .filter((chat) => !(type === 'archive' && enabled && chat.id === nextConversation.id && sidebarMode !== 'archived'));
        if (sidebarMode === 'archived' && type === 'archive' && !enabled) {
          return mapped.filter((chat) => chat.id !== nextConversation.id);
        }
        if (!hasCurrent && sidebarMode === 'archived' && nextConversation.archived) {
          return [nextConversation, ...mapped];
        }
        return mapped;
      });
      setChatMenuOpen(false);
      if (type === 'archive' && enabled && sidebarMode !== 'archived') {
        setShowList(true);
        setConversationMeta(null);
        setMessages([]);
        setActiveChatId(null);
        loadChats(null, 'active').catch(() => null);
      }
      if (type === 'archive' && !enabled && sidebarMode === 'archived') {
        setShowList(true);
        setConversationMeta(null);
        setMessages([]);
        setActiveChatId(null);
        loadChats(null, 'archived').catch(() => null);
      }
    } catch (error) {
      console.error('toggle chat preference failed', error);
      setErrorText(error?.message || 'Не удалось обновить настройки диалога.');
    }
  };

  const headerMeta = usingFallback ? activeChat : (conversationMeta || activeChat);
  const canLoadMore = Boolean(hasMore && nextCursor && !usingFallback);
  const activeIncomingRequest = requests.incoming.find((item) => item.conversation_id === activeChatId) || null;
  const headerStatusText = peerTyping
    ? 'печатает…'
    : formatPresenceStatus(peerPresence, headerMeta?.status || 'Ожидание данных');
  const activeChatsCount = filteredChats.length;
  const sidebarSubtitle = sidebarMode === 'requests'
    ? (requests.count ? `Нужно разобрать ${requests.count} запрос${requests.count === 1 ? '' : requests.count < 5 ? 'а' : 'ов'}` : 'Новых запросов нет')
    : sidebarMode === 'archived'
      ? (activeChatsCount ? `${activeChatsCount} в архиве` : 'Архив пуст')
      : sidebarMode === 'saved'
        ? (savedMessagesTotal ? `${savedMessagesTotal} сохранённ${savedMessagesTotal === 1 ? 'ое сообщение' : savedMessagesTotal < 5 ? 'ых сообщения' : 'ых сообщений'}` : 'Личные сохранённые сообщения')
        : (activeChatsCount ? `${activeChatsCount} диалог${activeChatsCount === 1 ? '' : activeChatsCount < 5 ? 'а' : 'ов'}` : 'Личные и групповые диалоги');
  const searchPlaceholder = sidebarMode === 'saved' ? 'Поиск по сохранённым сообщениям' : 'Поиск по чатам и сообщениям';
  const compactHeaderStatus = headerStatusText === 'доступен(а)' ? 'в сети' : headerStatusText;

  const openActivePeerProfile = useCallback(() => {
    const peerId = conversationMeta?.peer?.id || activeChat?.peer?.id || headerMeta?.peer?.id || null;
    const peerName = conversationMeta?.peer?.name || activeChat?.peer?.name || headerMeta?.peer?.name || '';
    if (!peerId) return;
    const params = new URLSearchParams({ from: 'chat', user: String(peerId) });
    if (peerName) params.set('name', peerName);
    router.push(`/profile/${peerId}?${params.toString()}`);
  }, [activeChat?.peer?.id, activeChat?.peer?.name, conversationMeta?.peer?.id, conversationMeta?.peer?.name, headerMeta?.peer?.id, headerMeta?.peer?.name, router]);

  useEffect(() => {
    setChatMenuOpen(false);
    if (showList) {
      setSelectedMessageId(null);
    }
  }, [activeChatId, showList]);

  useEffect(() => {
    if (!keyboardViewportState.open) return;
    setChatMenuOpen(false);
    setSelectedMessageId(null);
  }, [keyboardViewportState.open]);

  useEffect(() => {
    if (!keyboardViewportState.open || showList || !activeChatId) return undefined;
    const root = pageRootRef.current;
    const node = timelineRef.current;
    if (!root || !node || typeof document === 'undefined') return undefined;
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement) || !root.contains(activeElement)) return undefined;
    const tagName = String(activeElement.tagName || '').toLowerCase();
    const isTextInput = tagName === 'input' || tagName === 'textarea' || activeElement.isContentEditable;
    if (!isTextInput || !timelineScrollStateRef.current.nearBottom) return undefined;

    let rafOne = 0;
    let rafTwo = 0;
    rafOne = window.requestAnimationFrame(() => {
      rafTwo = window.requestAnimationFrame(() => {
        node.scrollTop = node.scrollHeight;
      });
    });
    return () => {
      if (rafOne) window.cancelAnimationFrame(rafOne);
      if (rafTwo) window.cancelAnimationFrame(rafTwo);
    };
  }, [activeChatId, keyboardViewportState.height, keyboardViewportState.open, showList]);

  useEffect(() => {
    const node = timelineRef.current;
    if (!node) return undefined;

    const syncTimelineSnapshot = () => {
      const distanceFromBottom = Math.max(0, node.scrollHeight - node.clientHeight - node.scrollTop);
      timelineScrollStateRef.current = {
        ...timelineScrollStateRef.current,
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
        clientHeight: node.clientHeight,
        nearBottom: distanceFromBottom <= 120,
      };
    };

    syncTimelineSnapshot();
    node.addEventListener('scroll', syncTimelineSnapshot, { passive: true });
    window.addEventListener('resize', syncTimelineSnapshot);
    return () => {
      node.removeEventListener('scroll', syncTimelineSnapshot);
      window.removeEventListener('resize', syncTimelineSnapshot);
    };
  }, [activeChatId, showList, timelineRef]);

  useLayoutEffect(() => {
    const node = timelineRef.current;
    if (!node) return;

    const prev = timelineScrollStateRef.current;
    const firstMessage = messages[0] || null;
    const lastMessage = messages[messages.length - 1] || null;
    const nextFirstKey = firstMessage ? String(firstMessage.id || firstMessage.client_id || '') : '';
    const nextLastKey = lastMessage ? String(lastMessage.id || lastMessage.client_id || '') : '';
    const sameChat = String(prev.chatId || '') === String(activeChatId || '');
    const prependedHistory = sameChat && prev.firstKey && nextFirstKey && prev.firstKey !== nextFirstKey && prev.lastKey === nextLastKey;
    const appendedTail = sameChat && prev.lastKey && nextLastKey && prev.lastKey !== nextLastKey && messages.length >= prev.count;
    const newestIsOutgoing = Boolean(lastMessage?.is_mine || lastMessage?.direction === 'outgoing');

    if (!sameChat) {
      if (!showList && activeChatId && messages.length) {
        node.scrollTop = node.scrollHeight;
      }
    } else if (prependedHistory) {
      const delta = node.scrollHeight - Number(prev.scrollHeight || 0);
      if (delta) node.scrollTop = Math.max(0, Number(prev.scrollTop || 0) + delta);
    } else if (appendedTail && (prev.nearBottom || newestIsOutgoing)) {
      node.scrollTop = node.scrollHeight;
    }

    const distanceFromBottom = Math.max(0, node.scrollHeight - node.clientHeight - node.scrollTop);
    timelineScrollStateRef.current = {
      chatId: activeChatId || null,
      firstKey: nextFirstKey,
      lastKey: nextLastKey,
      count: messages.length,
      scrollHeight: node.scrollHeight,
      scrollTop: node.scrollTop,
      clientHeight: node.clientHeight,
      nearBottom: distanceFromBottom <= 120,
    };
  }, [activeChatId, messages, showList]);

  const sidebarProps = {
    showList,
    sidebarSubtitle,
    momentItems: chatMomentItems,
    searchPlaceholder,
    search,
    setSearch,
    sidebarMode,
    setSidebarMode,
    requestsCount: requests.count,
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
  };

  const isMobileConversationOpen = !showList && Boolean(activeChatId);

  const conversationWorkspaceProps = {
    showList,
    setShowList,
    headerMeta,
    compactHeaderStatus,
    realtimeState,
    canOpenPeerProfile: Boolean((conversationMeta?.peer?.id || activeChat?.peer?.id || headerMeta?.peer?.id) && headerMeta?.type === 'direct'),
    onOpenPeerProfile: openActivePeerProfile,
    conversationSearchOpen,
    openConversationSearch,
    startConversationCall,
    callStartDisabled,
    mediaDiagnostics,
    hasDetectedCamera,
    chatMenuWrapRef,
    toggleChatMenu,
    chatMenuOpen,
    toggleChatPreference,
    conversationSearchInputRef,
    conversationSearchQuery,
    setConversationSearchQuery,
    stepConversationSearchResult,
    conversationSearchType,
    setConversationSearchType,
    conversationSearchLoading,
    conversationSearchResults,
    conversationSearchCurrentIndex,
    conversationSearchFocusedMessageId,
    conversationSearchError,
    conversationSearchNotice,
    goToConversationSearchResult,
    timelineRef,
    activeChatUnreadCount,
    unreadAnchorMessageId,
    conversationRequestState,
    jumpToUnread,
    jumpToLatest,
    messageSelectionMode,
    interactionMode,
    usingFallback,
    messageSelectionNotice,
    selectedMessages,
    hasMoreSelectableLoaded,
    selectableLoadedMessages,
    selectAllLoadedMessages,
    forwardSubmitting,
    messageBatchActionLoading,
    allLoadedSelectableChosen,
    selectableLoadedMessageIds,
    clearMessageSelection,
    shouldHidePinnedDuringSwitch,
    activePinnedEntry,
    openPinnedMessage,
    pinnedMessages,
    pinnedCurrentIndex,
    stepPinnedMessage,
    openPinnedPanel,
    pinnedMessagesLoading,
    mediaPreviewLabel,
    videoCallFallbackVisible,
    videoCallFallback,
    startAudioFallbackCall,
    activeChatId,
    callActionLoading,
    rerunVideoAvailabilityCheck,
    dismissVideoCallFallback,
    activeCall,
    callBannerTitle,
    callBannerText,
    callViewer,
    handleCallAction,
    canToggleCallMic,
    canToggleCallCamera,
    callClientError,
    callClientStatus,
    hasLiveCall,
    localCallReady,
    remoteCallReady,
    remoteCallAudioRef,
    remoteCallVideoRef,
    localCallVideoRef,
    canLoadMore,
    loadingOlder,
    loadMessages,
    nextCursor,
    showTimelineSkeleton,
    loadingMessages,
    errorText,
    timelineItems,
    selectedMessageId,
    focusedMessageId,
    setSelectedMessageId,
    selectedMessageIds,
    globalSearchFocusedMessageId,
    disableMessageActions,
    toggleMessageSelection,
    retryFailedMessage,
    dismissFailedMessage,
    handleReplyFromTimelineItem,
    handleQuickReact,
    jumpToMessage,
    selectedMessage,
    selectedMessageActionText,
    handleRetryMessage,
    beginReplyMessage,
    composerMode,
    messageActionLoading,
    handleCopyMessage,
    openForwardSheet,
    beginMultiMessageSelection,
    beginEditMessage,
    handleToggleSaveMessage,
    handleTogglePinMessage,
    handleReportSelectedMessage,
    handleDeleteMessage,
    closeSelectedMessage,
    replyingTo,
    replyDraftPulseKey,
    setReplyingTo,
    forwardSheetOpen,
    forwardSourceMessages,
    closeForwardSheet,
    forwardTargetsQuery,
    setForwardTargetsQuery,
    selectedMessagePreviewItems,
    forwardTargetChats,
    forwardSelectedChatIds,
    toggleForwardChatSelection,
    forwardComment,
    setForwardComment,
    handleForwardSelectedMessage,
    pinnedPanelOpen,
    closePinnedPanel,
    setPinnedCurrentIndex,
    attachmentSheetOpen,
    setAttachmentSheetOpen,
    launchAttachmentPicker,
    cancelComposerAction,
    videoNoteState,
    videoNoteLiveRef,
    closeVideoNoteRecorder,
    startVideoNoteRecording,
    stopVideoNoteRecording,
    retakeVideoNote,
    sendVideoNote,
    isDebugChat,
    runMediaProbe,
    refreshMediaProbeDiagnostics,
    openVideoNoteRecorder,
    voiceRecorderState,
    closeVoiceRecorder,
    stopVoiceRecording,
    retakeVoiceRecording,
    sendVoiceRecording,
    openVoiceRecorder,
    mediaProbeState,
    closeMediaProbe,
    pendingAttachment,
    pendingAttachments: pendingAttachmentItems,
    readyAttachmentCount,
    failedAttachmentCount,
    isAttachmentUploading,
    hasReadyAttachment,
    hasFailedAttachment,
    draftState,
    uploadingAttachment,
    retryPendingAttachment,
    clearPendingAttachment,
    fileInputRef,
    handleAttachmentChange,
    openAttachmentPicker,
    composeBlockedByRequest,
    activeIncomingRequest,
    handleRequestAction,
    message,
    setMessage,
    handleSend,
    composerSendBlocked,
    selectedSavableMessages,
    handleBatchToggleSaveSelectedMessages,
    selectedUnsavableMessages,
    selectedDeletableMessages,
    handleBatchDeleteSelectedMessages,
  };

  return (
    <div className="app-shell chatW-shell-page">
      <div ref={pageRootRef} className={`chatW-page ${isMobileConversationOpen ? 'is-mobile-chat-open' : ''}`}>
        <div className="chatW-layout">
          <ChatSidebar {...sidebarProps} />
          <ChatConversationWorkspace {...conversationWorkspaceProps} />
        </div>

        <PostAuthBottomNav current="chat" />
      </div>
    </div>
  );
}
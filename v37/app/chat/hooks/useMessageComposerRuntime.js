'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decryptMessagePayload, prepareEncryptedMessagePayload } from '@/lib/e2ee-client';

function formatTimeForLocal(value) {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function useMessageComposerRuntime({
  activeChat,
  activeChatId,
  message,
  composerMode,
  editingMessageId,
  replyingTo,
  usingFallback,
  composeBlockedByRequest,
  pendingAttachment,
  pendingAttachments = [],
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
}) {
  const [sending, setSending] = useState(false);
  const [draftState, setDraftState] = useState('idle');
  const typingStopTimeoutRef = useRef(null);

  useEffect(() => {
    setDraftState('idle');
  }, [activeChatId]);

  useEffect(() => {
    if (!activeChatId || usingFallback || composerMode !== 'send') return undefined;
    const knownDraft = draftSnapshotRef.current?.[activeChatId] ?? '';
    if (message === knownDraft) return undefined;
    setDraftState('saving');
    const timeout = setTimeout(async () => {
      try {
        const method = message.trim() ? 'PUT' : 'DELETE';
        const options = method === 'PUT'
          ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: message }) }
          : { method };
        const response = await fetch(`/api/chats/${activeChatId}/draft`, options);
        const payload = await readJsonSafe(response);
        if (!response.ok) throw new Error(payload?.error || 'Не удалось сохранить черновик.');
        draftSnapshotRef.current[activeChatId] = message;
        setChats((prev) => prev.map((chat) => (chat.id === activeChatId ? { ...chat, draft_text: message || '' } : chat)));
        setDraftState('saved');
      } catch (error) {
        console.error('chat draft save failed', error);
        setDraftState('error');
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [activeChatId, composerMode, draftSnapshotRef, message, readJsonSafe, setChats, usingFallback]);

  useEffect(() => {
    if (!activeChatId || usingFallback || composerMode !== 'send') return undefined;
    const text = message.trim();
    if (!text) {
      fetch(`/api/chats/${activeChatId}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typing: false }),
      }).catch(() => null);
      return undefined;
    }

    fetch(`/api/chats/${activeChatId}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typing: true }),
    }).catch(() => null);

    clearTimeout(typingStopTimeoutRef.current);
    typingStopTimeoutRef.current = setTimeout(() => {
      fetch(`/api/chats/${activeChatId}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typing: false }),
      }).catch(() => null);
    }, 1400);

    return () => clearTimeout(typingStopTimeoutRef.current);
  }, [activeChatId, composerMode, message, usingFallback]);

  const sendOptimisticMessage = useCallback(async (text, retryingMessage = null, attachmentOverride = null) => {
    if (!activeChat?.id || usingFallback) return false;
    const attachment = attachmentOverride || (retryingMessage?.media ? { message_type: retryingMessage.type, media: retryingMessage.media } : null);
    const messageType = attachment?.message_type || retryingMessage?.type || 'text';
    const previewText = text || retryingMessage?.preview_text || mediaPreviewLabel(messageType, attachment?.media || retryingMessage?.media);
    const clientId = retryingMessage?.client_id || makeClientId();
    const replyTarget = retryingMessage?.reply_to || (composerMode === 'send' ? replyingTo : null);
    const mergedMetadata = {
      ...(attachment?.metadata && typeof attachment.metadata === 'object' ? attachment.metadata : {}),
      ...(retryingMessage?.metadata && typeof retryingMessage.metadata === 'object' ? retryingMessage.metadata : {}),
    };
    const optimistic = {
      id: retryingMessage?.id || `local:${clientId}`,
      client_id: clientId,
      type: messageType,
      text,
      preview_text: previewText,
      media: attachment?.media || retryingMessage?.media || null,
      metadata: Object.keys(mergedMetadata).length ? mergedMetadata : null,
      reply_to: replyTarget || null,
      direction: 'outgoing',
      is_mine: true,
      is_saved: Boolean(retryingMessage?.is_saved),
      reported_by_me: Boolean(retryingMessage?.reported_by_me),
      can_forward: false,
      send_error: null,
      state: 'sending',
      is_encrypted: Boolean(text),
      created_at: retryingMessage?.created_at || new Date().toISOString(),
      updated_at: retryingMessage?.updated_at || new Date().toISOString(),
      time: retryingMessage?.time || formatTimeForLocal(Date.now()),
      sender: retryingMessage?.sender || null,
    };

    setMessages((prev) => mergeMessages(prev, [optimistic], 'append'));
    setChats((prev) => prev.map((chat) => (chat.id === activeChat.id ? { ...chat, preview: `Вы: ${previewText}`, time: optimistic.time, draft_text: '' } : chat)));
    if (draftSnapshotRef.current) draftSnapshotRef.current[activeChat.id] = '';
    setDraftState('idle');

    try {
      const encryptionPayload = text ? await prepareEncryptedMessagePayload(activeChat.id, text) : null;
      const response = await fetch(`/api/chats/${activeChat.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: encryptionPayload ? '' : text,
          clientId,
          type: messageType,
          media: attachment?.media || null,
          metadata: Object.keys(mergedMetadata).length ? mergedMetadata : null,
          replyToMessageId: replyTarget?.id || null,
          encryption: encryptionPayload?.encryption || null,
        }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.message) throw new Error(payload?.error || 'Не удалось отправить сообщение.');
      const resolvedMessage = await decryptMessagePayload(payload.message).catch(() => payload.message);
      if (attachment?.media?.url) markUploadedMediaCommitted(attachment.media);
      setMessages((prev) => mergeMessages(prev.filter((item) => item.client_id !== clientId && item.id !== optimistic.id), [resolvedMessage], 'append'));
      scheduleChatsRefresh(activeChat.id);
      loadRequests().catch(() => null);
      return true;
    } catch (error) {
      const messageText = error?.message || 'Не удалось отправить сообщение.';
      const blockedByRequestError = /примет запрос на переписку|запрос на переписку/i.test(messageText);
      if (blockedByRequestError) {
        setMessages((prev) => prev.filter((item) => item.client_id !== clientId && item.id !== optimistic.id));
        setErrorText('Дождитесь принятия запроса на переписку.');
      } else {
        console.error('chat send failed', error);
        setMessages((prev) => prev.map((item) => (item.client_id === clientId ? { ...item, state: 'failed', send_error: messageText } : item)));
        setErrorText(messageText);
      }
      return false;
    }
  }, [activeChat, composerMode, draftSnapshotRef, loadRequests, makeClientId, markUploadedMediaCommitted, mediaPreviewLabel, mergeMessages, readJsonSafe, replyingTo, scheduleChatsRefresh, setChats, setErrorText, setMessages, usingFallback]);

  const sendVoiceRecording = useCallback(async () => {
    if (!voiceRecorderState.blob || !activeChat?.id || usingFallback) return;
    dispatchVoiceRecorder({ type: 'SEND_START' });
    setErrorText('');
    try {
      const normalizedMime = String(voiceRecorderState.mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';
      const extension = normalizedMime.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([voiceRecorderState.blob], `voice-message.${extension}`, {
        type: normalizedMime,
        lastModified: Date.now(),
      });
      const uploadPayload = await queueChatMediaUpload({
        file,
        kind: 'voice',
        conversationId: activeChat.id,
        metadata: {
          durationSec: Math.max(1, Math.round((voiceRecorderState.elapsedMs || 0) / 1000)),
          waveform: Array.isArray(voiceRecorderState.waveform) ? voiceRecorderState.waveform : undefined,
        },
      });
      const ok = await sendOptimisticMessage('', null, {
        message_type: uploadPayload.message_type || 'voice',
        media: uploadPayload.media,
        original_name: file.name,
      });
      if (!ok) throw new Error('Не удалось отправить голосовое сообщение.');
      cleanupVoiceRecorderResources();
    } catch (error) {
      dispatchVoiceRecorder({ type: 'ERROR', requestId: voiceRecorderState.requestId, code: 'send_failed', message: error?.message || 'Не удалось отправить голосовое сообщение.' });
    }
  }, [activeChat, cleanupVoiceRecorderResources, dispatchVoiceRecorder, queueChatMediaUpload, sendOptimisticMessage, setErrorText, usingFallback, voiceRecorderState]);

  const sendVideoNote = useCallback(async () => {
    if (!videoNoteState.blob || !activeChat?.id || usingFallback) return;
    dispatchVideoNote({ type: 'SEND_START' });
    setErrorText('');
    try {
      const normalizedMime = String(videoNoteState.mimeType || 'video/webm').split(';')[0].trim() || 'video/webm';
      const extension = normalizedMime.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([videoNoteState.blob], `video-note.${extension}`, {
        type: normalizedMime,
        lastModified: Date.now(),
      });
      const uploadPayload = await queueChatMediaUpload({
        file,
        kind: 'video_note',
        conversationId: activeChat.id,
        metadata: { durationSec: Math.max(1, Math.round((videoNoteState.elapsedMs || 0) / 1000)) },
      });
      const ok = await sendOptimisticMessage('', null, {
        message_type: uploadPayload.message_type || 'video_note',
        media: uploadPayload.media,
        original_name: file.name,
      });
      if (!ok) throw new Error('Не удалось отправить видеокружок.');
      cleanupVideoNoteResources();
    } catch (error) {
      dispatchVideoNote({ type: 'ERROR', requestId: videoNoteState.requestId, code: 'send_failed', message: error?.message || 'Не удалось отправить видеокружок.' });
    }
  }, [activeChat, cleanupVideoNoteResources, dispatchVideoNote, queueChatMediaUpload, sendOptimisticMessage, setErrorText, usingFallback, videoNoteState]);

  const handleSend = useCallback(async () => {
    const text = message.trim();
    const readyAttachments = pendingAttachments.filter((item) => item?.status === 'ready' && item?.media);
    if (!text && !readyAttachments.length) return;
    if (composeBlockedByRequest) {
      setErrorText('Дождитесь принятия запроса на переписку.');
      return;
    }
    if (hasFailedAttachment) {
      setErrorText('Сначала повторите загрузку вложения или уберите его.');
      return;
    }
    if (!activeChat?.id || usingFallback) {
      if (usingFallback && text) {
        setChats((prev) => prev.map((chat) => {
          if (chat.id !== activeChat?.id) return chat;
          return {
            ...chat,
            preview: text,
            time: formatTimeForLocal(Date.now()),
            messages: [...chat.messages, { id: `local-${Date.now()}`, type: 'message', direction: 'outgoing', text, time: formatTimeForLocal(Date.now()), state: 'read' }],
          };
        }));
        setMessage('');
      }
      return;
    }

    setSending(true);
    setErrorText('');
    try {
      if (composerMode === 'edit' && editingMessageId) {
        const response = await fetch(`/api/messages/${editingMessageId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const payload = await readJsonSafe(response);
        if (!response.ok || !payload?.message) throw new Error(payload?.error || 'Не удалось изменить сообщение.');
        setMessages((prev) => mergeMessages(prev, [payload.message], 'append'));
      } else if (readyAttachments.length) {
        const mediaGroupId = readyAttachments.length > 1 ? `media-group:${makeClientId()}` : '';
        for (let index = 0; index < readyAttachments.length; index += 1) {
          const attachment = readyAttachments[index];
          const attachmentMetadata = {
            ...(attachment?.metadata && typeof attachment.metadata === 'object' ? attachment.metadata : {}),
            ...(mediaGroupId ? {
              media_group_id: mediaGroupId,
              media_group_index: index,
              media_group_total: readyAttachments.length,
            } : {}),
          };
          const ok = await sendOptimisticMessage(index === 0 ? text : '', null, {
            ...attachment,
            metadata: Object.keys(attachmentMetadata).length ? attachmentMetadata : null,
          });
          if (!ok) return;
          markPendingAttachmentCommitted?.(attachment.local_id);
        }
      } else {
        const ok = await sendOptimisticMessage(text, null, pendingAttachment);
        if (!ok) return;
      }
      if (activeChat?.id && !usingFallback) {
        fetch(`/api/chats/${activeChat.id}/typing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ typing: false }),
        }).catch(() => null);
      }
      setMessage('');
      resetAttachmentUiState();
      setEditingMessageId(null);
      setReplyingTo(null);
      setSelectedMessageId(null);
      setComposerMode('send');
    } catch (error) {
      console.error('chat send/edit failed', error);
      setErrorText(error?.message || 'Не удалось выполнить действие с сообщением.');
    } finally {
      setSending(false);
    }
  }, [activeChat, composeBlockedByRequest, composerMode, editingMessageId, hasFailedAttachment, makeClientId, markPendingAttachmentCommitted, mergeMessages, message, pendingAttachment, pendingAttachments, readJsonSafe, resetAttachmentUiState, sendOptimisticMessage, setChats, setComposerMode, setEditingMessageId, setErrorText, setMessage, setMessages, setReplyingTo, setSelectedMessageId, usingFallback]);

  const composerSendBlocked = useMemo(() => {
    if (sending || isAttachmentUploading) return true;
    if (composeBlockedByRequest) return true;
    if (!activeChat?.id && !usingFallback) return true;
    if (composerMode === 'edit') return !message.trim();
    return !message.trim() && !hasReadyAttachment;
  }, [activeChat?.id, composeBlockedByRequest, composerMode, hasReadyAttachment, isAttachmentUploading, message, sending, usingFallback]);

  return {
    sending,
    draftState,
    sendOptimisticMessage,
    sendVoiceRecording,
    sendVideoNote,
    handleSend,
    composerSendBlocked,
  };
}

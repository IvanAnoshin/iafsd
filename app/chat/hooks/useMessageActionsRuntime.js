'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

function messageIdentity(item) {
  return item?.id || item?.client_id || null;
}

function scrubMessageRelations(items, removedIds = []) {
  const removed = new Set((Array.isArray(removedIds) ? removedIds : [removedIds]).map((value) => String(value || '')).filter(Boolean));
  return (Array.isArray(items) ? items : []).map((item) => {
    const replyId = item?.reply_to?.id ? String(item.reply_to.id) : '';
    if (replyId && removed.has(replyId)) {
      return { ...item, reply_to: null };
    }
    return item;
  });
}

export function useMessageActionsRuntime({
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
  askActionText,
  confirmAction,
}) {
  const [messageActionLoading, setMessageActionLoading] = useState(false);

  useEffect(() => {
    setSelectedMessageId(null);
    setMessageActionLoading(false);
  }, [activeChatId, setSelectedMessageId]);

  const selectedMessage = useMemo(
    () => messages.find((item) => item.id === selectedMessageId || item.client_id === selectedMessageId) || null,
    [messages, selectedMessageId],
  );

  const selectedMessagePreviewText = useMemo(
    () => (selectedMessage
      ? (selectedMessage.text || selectedMessage.preview_text || mediaPreviewLabel(selectedMessage.type, selectedMessage.media))
      : ''),
    [mediaPreviewLabel, selectedMessage],
  );


  useEffect(() => {
    if (!selectedMessageId) return;
    if (selectedMessage) return;
    setSelectedMessageId(null);
  }, [selectedMessage, selectedMessageId, setSelectedMessageId]);

  useEffect(() => {
    if (!editingMessageId) return;
    const editingTarget = messages.find((item) => item.id === editingMessageId || item.client_id === editingMessageId) || null;
    if (editingTarget && !editingTarget.deleted) return;
    setComposerMode('send');
    setEditingMessageId(null);
    setMessage(draftSnapshotRef.current[activeChatId] ?? '');
  }, [activeChatId, draftSnapshotRef, editingMessageId, messages, setComposerMode, setEditingMessageId, setMessage]);

  useEffect(() => {
    if (!replyingTo?.id) return;
    const replyTarget = messages.find((item) => item.id === replyingTo.id || item.client_id === replyingTo.id) || null;
    if (replyTarget && !replyTarget.deleted) return;
    setReplyingTo(null);
  }, [messages, replyingTo, setReplyingTo]);

  const closeSelectedMessage = useCallback(() => {
    setSelectedMessageId(null);
  }, []);

  const beginEditMessage = useCallback(() => {
    if (!selectedMessage || !selectedMessage.is_mine || selectedMessage.deleted || selectedMessage.state === 'sending') return;
    if (!['text', 'system'].includes(selectedMessage.type || 'text')) return;
    setReplyingTo(null);
    setComposerMode('edit');
    setEditingMessageId(selectedMessage.id);
    setMessage(selectedMessage.text || '');
  }, [selectedMessage, setComposerMode, setEditingMessageId, setMessage, setReplyingTo]);

  const beginReplyMessage = useCallback(() => {
    if (!selectedMessage || selectedMessage.deleted || selectedMessage.state === 'sending') return;
    const author = selectedMessage.is_mine ? 'Вы' : (selectedMessage.sender?.name || 'Пользователь');
    setReplyingTo({
      id: selectedMessage.id,
      author,
      text: selectedMessagePreviewText || 'Сообщение',
      type: selectedMessage.type || 'text',
      isEncrypted: Boolean(selectedMessage.is_encrypted || selectedMessage.isEncrypted),
    });
    setComposerMode('send');
    setEditingMessageId(null);
    setSelectedMessageId(null);
  }, [selectedMessage, selectedMessagePreviewText, setComposerMode, setEditingMessageId, setReplyingTo]);

  const handleCopyMessage = useCallback(async () => {
    if (!selectedMessage) return;
    const textToCopy = String(selectedMessage.text || selectedMessage.preview_text || '').trim();
    if (!textToCopy) {
      setErrorText('В этом сообщении нет текста для копирования.');
      return;
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setErrorText('');
      setSelectedMessageId(null);
    } catch (error) {
      console.error('chat message copy failed', error);
      setErrorText('Не удалось скопировать сообщение.');
    }
  }, [selectedMessage, setErrorText]);

  const handleToggleSaveMessage = useCallback(async () => {
    if (!selectedMessage?.id || usingFallback) return;
    if (String(selectedMessage.id).startsWith('local:') || selectedMessage.state === 'sending' || selectedMessage.state === 'failed' || selectedMessage.deleted) return;
    setMessageActionLoading(true);
    try {
      const response = await fetch(`/api/messages/${selectedMessage.id}/save`, {
        method: selectedMessage.is_saved ? 'DELETE' : 'POST',
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.message) throw new Error(payload?.error || 'Не удалось обновить сохранённые сообщения.');
      setMessages((prev) => mergeMessages(prev, [payload.message], 'append'));
      applySavedMessageMutation(payload.message);
      setErrorText('');
      setSelectedMessageId(null);
    } catch (error) {
      console.error('chat message save toggle failed', error);
      setErrorText(error?.message || 'Не удалось обновить сохранённые сообщения.');
    } finally {
      setMessageActionLoading(false);
    }
  }, [applySavedMessageMutation, mergeMessages, readJsonSafe, selectedMessage, setErrorText, setMessages, usingFallback]);

  const handleReportSelectedMessage = useCallback(async () => {
    if (!selectedMessage?.id || usingFallback || selectedMessage.is_mine || selectedMessage.deleted) return;
    const reason = await askActionText?.({ title: 'Жалоба на сообщение', label: 'Причина', placeholder: 'Спам, оскорбление, мошенничество, угрозы', initialValue: 'спам', submitLabel: 'Отправить' });
    if (reason == null) return;
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason) {
      setErrorText('Укажи причину жалобы.');
      return;
    }
    const details = await askActionText?.({ title: 'Комментарий к жалобе', label: 'Детали', placeholder: 'Необязательно', initialValue: '', submitLabel: 'Продолжить', required: false });
    const canBlockPeer = conversationMeta?.type === 'direct' && selectedMessage?.sender?.id && !selectedMessage.is_mine;
    const blockFutureMessages = canBlockPeer
      ? await confirmAction?.({ title: 'Ограничить входящие?', text: 'После жалобы можно сразу ограничить будущие сообщения от этого пользователя в этом диалоге.', submitLabel: 'Ограничить', danger: true })
      : false;
    setMessageActionLoading(true);
    try {
      const response = await fetch(`/api/messages/${selectedMessage.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: normalizedReason, details: details || '', block_future_messages: blockFutureMessages }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.message) throw new Error(payload?.error || 'Не удалось отправить жалобу.');
      setMessages((prev) => mergeMessages(prev, [payload.message], 'append'));
      if (payload?.blocked_peer) {
        await loadRequests();
        setConversationMeta((prev) => (prev ? { ...prev, request_state: 'blocked' } : prev));
        setChats((prev) => prev.map((chat) => (chat.id === activeChatId ? { ...chat, request_state: 'blocked' } : chat)));
      }
      setErrorText('');
      setSelectedMessageId(null);
    } catch (error) {
      console.error('chat message report failed', error);
      setErrorText(error?.message || 'Не удалось отправить жалобу.');
    } finally {
      setMessageActionLoading(false);
    }
  }, [activeChatId, askActionText, confirmAction, conversationMeta?.type, loadRequests, mergeMessages, readJsonSafe, selectedMessage, setChats, setConversationMeta, setErrorText, setMessages, usingFallback]);

  const handleTogglePinMessage = useCallback(async () => {
    if (!selectedMessage?.id || usingFallback) return;
    if (String(selectedMessage.id).startsWith('local:') || selectedMessage.state === 'sending' || selectedMessage.state === 'failed' || selectedMessage.deleted) return;
    setMessageActionLoading(true);
    try {
      const response = await fetch(`/api/messages/${selectedMessage.id}/pin`, {
        method: selectedMessage.is_pinned ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.message) throw new Error(payload?.error || 'Не удалось обновить закреп.');
      setMessages((prev) => mergeMessages(prev, [payload.message], 'append'));
      if (activeChatId) await loadPinnedMessages(activeChatId);
      setErrorText('');
      setSelectedMessageId(null);
    } catch (error) {
      console.error('chat message pin toggle failed', error);
      setErrorText(error?.message || 'Не удалось обновить закреп сообщения.');
    } finally {
      setMessageActionLoading(false);
    }
  }, [activeChatId, loadPinnedMessages, mergeMessages, readJsonSafe, selectedMessage, setErrorText, setMessages, usingFallback]);


  const handleDeleteMessage = useCallback(async () => {
    if (!selectedMessage?.id || usingFallback) return;
    try {
      if (String(selectedMessage.id).startsWith('local:') && selectedMessage.state === 'failed') {
        const removedIds = [messageIdentity(selectedMessage), selectedMessage?.id, selectedMessage?.client_id];
        if (selectedMessage?.media?.url) await releaseChatMediaUpload(selectedMessage.media, { silent: true });
        setMessages((prev) => scrubMessageRelations(prev.filter((item) => item.id !== selectedMessage.id), removedIds));
        setSelectedMessageId(null);
        setComposerMode('send');
        setEditingMessageId(null);
        setReplyingTo((prev) => (prev?.id && removedIds.includes(prev.id) ? null : prev));
        if (message && editingMessageId === selectedMessage.id) setMessage('');
        return;
      }
      const response = await fetch(`/api/messages/${selectedMessage.id}`, { method: 'DELETE' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.message) throw new Error(payload?.error || 'Не удалось удалить сообщение.');
      const removedIds = [messageIdentity(selectedMessage), selectedMessage?.id, selectedMessage?.client_id, payload?.message?.id].map((value) => String(value || '')).filter(Boolean);
      setMessages((prev) => scrubMessageRelations(prev.filter((item) => messageIdentity(item) !== messageIdentity(selectedMessage)), removedIds));
      setSelectedMessageId(null);
      setComposerMode('send');
      setEditingMessageId(null);
      setReplyingTo((prev) => (prev?.id && removedIds.includes(String(prev.id)) ? null : prev));
      if (message && editingMessageId === selectedMessage.id) setMessage('');
      scheduleChatsRefresh(activeChat?.id || activeChatId || null);
    } catch (error) {
      console.error('chat delete failed', error);
      setErrorText(error?.message || 'Не удалось удалить сообщение.');
    }
  }, [activeChat?.id, activeChatId, editingMessageId, mergeMessages, message, readJsonSafe, releaseChatMediaUpload, scheduleChatsRefresh, selectedMessage, setComposerMode, setEditingMessageId, setErrorText, setMessage, setMessages, usingFallback]);

  const retryFailedMessage = useCallback(async (messageItem) => {
    if (!messageItem?.is_mine || messageItem?.state !== 'failed') return;
    setSelectedMessageId(messageIdentity(messageItem));
    await sendOptimisticMessage(
      messageItem.text || '',
      messageItem,
      messageItem?.media ? { message_type: messageItem.type, media: messageItem.media } : null,
    );
  }, [sendOptimisticMessage]);

  const dismissFailedMessage = useCallback(async (messageItem) => {
    const failedId = String(messageIdentity(messageItem) || '');
    const removedIds = [failedId, messageItem?.id, messageItem?.client_id].map((value) => String(value || '')).filter(Boolean);
    if (!failedId || messageItem?.state !== 'failed') return;
    if (messageItem?.media?.url) await releaseChatMediaUpload(messageItem.media, { silent: true });
    setMessages((prev) => scrubMessageRelations(prev.filter((item) => String(messageIdentity(item) || '') !== failedId), removedIds));
    setSelectedMessageId((prev) => (removedIds.includes(String(prev || '')) ? null : prev));
    setReplyingTo((prev) => (prev?.id && removedIds.includes(String(prev.id)) ? null : prev));
    if (editingMessageId && removedIds.includes(String(editingMessageId))) {
      setComposerMode('send');
      setEditingMessageId(null);
      setMessage(draftSnapshotRef.current[activeChatId] ?? '');
    }
  }, [activeChatId, draftSnapshotRef, editingMessageId, releaseChatMediaUpload, setComposerMode, setEditingMessageId, setMessage, setMessages, setReplyingTo]);

  const handleRetryMessage = useCallback(async () => {
    await retryFailedMessage(selectedMessage);
  }, [retryFailedMessage, selectedMessage]);

  const cancelComposerAction = useCallback(() => {
    setComposerMode('send');
    setEditingMessageId(null);
    setReplyingTo(null);
    setSelectedMessageId(null);
    setMessage(draftSnapshotRef.current[activeChatId] ?? '');
  }, [activeChatId, draftSnapshotRef, setComposerMode, setEditingMessageId, setMessage, setReplyingTo]);

  return {
    selectedMessageId,
    selectedMessage,
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
  };
}

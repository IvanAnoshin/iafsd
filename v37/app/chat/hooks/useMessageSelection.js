'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

function messageIdentity(item) {
  return String(item?.id || item?.client_id || '').trim();
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

export function useMessageSelection({
  activeChatId,
  activeChat,
  chats,
  messages,
  selectedMessage,
  editingMessageId,
  replyingTo,
  usingFallback,
  maxBatchSelection = 10,
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
}) {
  const [forwardSheetOpen, setForwardSheetOpen] = useState(false);
  const [forwardTargetsQuery, setForwardTargetsQuery] = useState('');
  const [forwardSelectedChatIds, setForwardSelectedChatIds] = useState([]);
  const [forwardComment, setForwardComment] = useState('');
  const [forwardSubmitting, setForwardSubmitting] = useState(false);
  const [messageSelectionMode, setMessageSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);
  const [messageBatchActionLoading, setMessageBatchActionLoading] = useState(false);
  const [messageSelectionNotice, setMessageSelectionNotice] = useState('');
  const interactionMode = messageSelectionMode ? 'selection' : 'normal';

  const messageIndex = useMemo(() => new Map(messages.map((item) => [messageIdentity(item), item]).filter(([id]) => Boolean(id))), [messages]);

  const selectedMessages = useMemo(() => {
    if (!selectedMessageIds.length) return [];
    return selectedMessageIds.map((id) => messageIndex.get(String(id))).filter(Boolean);
  }, [messageIndex, selectedMessageIds]);

  const selectableLoadedMessages = useMemo(() => messages.filter((item) => canBatchSelectMessage(item)), [canBatchSelectMessage, messages]);
  const selectableLoadedMessageIds = useMemo(() => selectableLoadedMessages
    .map((item) => messageIdentity(item))
    .filter(Boolean)
    .slice(0, maxBatchSelection), [maxBatchSelection, selectableLoadedMessages]);
  const hasMoreSelectableLoaded = selectableLoadedMessages.length > maxBatchSelection;
  const allLoadedSelectableChosen = Boolean(selectableLoadedMessageIds.length)
    && selectableLoadedMessageIds.every((id) => selectedMessageIds.includes(id));

  const selectedForwardableMessages = useMemo(() => selectedMessages.filter((item) => item?.can_forward && !item?.deleted && item?.state !== 'failed' && item?.state !== 'sending'), [selectedMessages]);
  const selectedSavableMessages = useMemo(() => selectedMessages.filter((item) => item?.can_save && !item?.is_saved && !messageIdentity(item).startsWith('local:')), [selectedMessages]);
  const selectedUnsavableMessages = useMemo(() => selectedMessages.filter((item) => item?.can_save && item?.is_saved && !messageIdentity(item).startsWith('local:')), [selectedMessages]);
  const selectedDeletableMessages = useMemo(() => selectedMessages.filter((item) => item?.can_delete && !item?.deleted), [selectedMessages]);

  const selectedEncryptedMessages = useMemo(
    () => selectedMessages.filter((item) => Boolean(item?.is_encrypted || item?.isEncrypted)),
    [selectedMessages],
  );

  const encryptedSelectionHint = useMemo(() => {
    if (!selectedEncryptedMessages.length) return '';
    if (!selectedForwardableMessages.length) {
      return selectedEncryptedMessages.length > 1
        ? 'Выбраны только защищённые сообщения. Их можно сохранить или удалить, но нельзя переслать.'
        : 'Выбрано защищённое сообщение. Его можно сохранить или удалить, но нельзя переслать.';
    }
    return selectedEncryptedMessages.length > 1
      ? `Защищённые сообщения (${selectedEncryptedMessages.length}) останутся вне пересылки.`
      : 'Одно защищённое сообщение останется вне пересылки.';
  }, [selectedEncryptedMessages, selectedForwardableMessages.length]);

  const forwardSourceMessages = useMemo(() => {
    if (messageSelectionMode) return selectedForwardableMessages;
    return selectedMessage?.can_forward ? [selectedMessage] : [];
  }, [messageSelectionMode, selectedForwardableMessages, selectedMessage]);

  const selectedMessagePreviewItems = useMemo(() => forwardSourceMessages
    .slice(0, 3)
    .map((item) => (item?.is_encrypted || item?.isEncrypted
      ? 'Защищённое сообщение'
      : (item?.forwarded_from?.preview_text || item?.text || item?.preview_text || mediaPreviewLabel(item?.type, item?.media))))
    .filter(Boolean), [forwardSourceMessages, mediaPreviewLabel]);

  const selectedMessageActionText = useMemo(() => {
    if (!selectedMessage) return '';
    if (selectedMessage.state === 'failed') return 'Сообщение не отправлено';
    if (selectedMessage.deleted) return 'Сообщение удалено';
    if (selectedMessage.is_encrypted || selectedMessage.isEncrypted) {
      return selectedMessage.is_mine ? 'Выбрано ваше защищённое сообщение' : 'Выбрано защищённое сообщение';
    }
    return selectedMessage.is_mine ? 'Выбрано ваше сообщение' : 'Выбрано сообщение собеседника';
  }, [selectedMessage]);

  const forwardTargetChats = useMemo(() => {
    const query = forwardTargetsQuery.trim().toLowerCase();
    const source = chats.filter((chat) => Boolean(chat?.id));
    if (!query) return source;
    return source.filter((chat) => [chat.name, chat.preview, chat.status].join(' ').toLowerCase().includes(query));
  }, [chats, forwardTargetsQuery]);

  const resetForwardState = useCallback(() => {
    setForwardSheetOpen(false);
    setForwardTargetsQuery('');
    setForwardSelectedChatIds([]);
    setForwardComment('');
  }, []);

  const resetSelectionState = useCallback(() => {
    setMessageSelectionMode(false);
    setSelectedMessageIds([]);
    setMessageSelectionNotice('');
  }, []);

  useEffect(() => {
    resetForwardState();
    resetSelectionState();
  }, [activeChatId, resetForwardState, resetSelectionState]);

  useEffect(() => {
    if (!selectedMessageIds.length) return;
    const nextSelectedIds = selectedMessageIds.filter((id) => {
      const item = messageIndex.get(String(id));
      return item && canBatchSelectMessage(item);
    });
    if (nextSelectedIds.length === selectedMessageIds.length) return;
    setSelectedMessageIds(nextSelectedIds);
    if (!nextSelectedIds.length) {
      setMessageSelectionMode(false);
      setMessageSelectionNotice('');
    }
  }, [canBatchSelectMessage, messageIndex, selectedMessageIds]);

  const toggleForwardChatSelection = useCallback((chatId) => {
    setForwardSelectedChatIds((prev) => prev.includes(chatId) ? prev.filter((item) => item !== chatId) : [...prev, chatId]);
  }, []);

  const toggleMessageSelection = useCallback((item, options = {}) => {
    const silentBlocked = Boolean(options?.silentBlocked);
    const targetId = messageIdentity(item);
    if (!targetId) return;
    if (!canBatchSelectMessage(item)) {
      if (!silentBlocked) setErrorText('Это сообщение сейчас нельзя добавить в пакетные действия.');
      return;
    }
    if (!selectedMessageIds.includes(targetId) && selectedMessageIds.length >= maxBatchSelection) {
      setErrorText(`Можно выбрать до ${maxBatchSelection} сообщений за раз.`);
      return;
    }
    setMessageSelectionNotice('');
    setSelectedMessageIds((prev) => prev.includes(targetId) ? prev.filter((id) => id !== targetId) : [...prev, targetId]);
  }, [canBatchSelectMessage, maxBatchSelection, selectedMessageIds, setErrorText]);

  const beginMultiMessageSelection = useCallback(() => {
    if (!selectedMessage) return;
    const targetId = messageIdentity(selectedMessage);
    if (!targetId) return;
    if (!canBatchSelectMessage(selectedMessage)) {
      setErrorText('Это сообщение сейчас нельзя добавить в пакетные действия.');
      return;
    }
    setMessageSelectionNotice('');
    setMessageSelectionMode(true);
    setSelectedMessageIds([targetId]);
    setSelectedMessageId(null);
  }, [canBatchSelectMessage, selectedMessage, setErrorText, setSelectedMessageId]);

  const selectAllLoadedMessages = useCallback(() => {
    if (usingFallback || forwardSubmitting || messageBatchActionLoading) return;
    if (!selectableLoadedMessageIds.length) {
      setErrorText('В загруженной части пока нет сообщений для пакетных действий.');
      return;
    }
    setMessageSelectionMode(true);
    setSelectedMessageId(null);
    setSelectedMessageIds(selectableLoadedMessageIds);
    if (hasMoreSelectableLoaded) {
      setMessageSelectionNotice(`В загруженной части найдено ${selectableLoadedMessages.length} подходящих сообщений. Выбраны первые ${maxBatchSelection}.`);
    } else {
      setMessageSelectionNotice('Выбраны все подходящие сообщения из загруженной части.');
    }
  }, [forwardSubmitting, hasMoreSelectableLoaded, maxBatchSelection, messageBatchActionLoading, selectableLoadedMessageIds, selectableLoadedMessages.length, setErrorText, setSelectedMessageId, usingFallback]);

  const clearMessageSelection = useCallback(() => {
    if (forwardSubmitting || messageBatchActionLoading) return;
    resetSelectionState();
  }, [forwardSubmitting, messageBatchActionLoading, resetSelectionState]);

  const openForwardSheet = useCallback(() => {
    if (!forwardSourceMessages.length || usingFallback) return;
    setForwardSelectedChatIds([]);
    setForwardTargetsQuery('');
    setForwardComment('');
    setForwardSheetOpen(true);
  }, [forwardSourceMessages.length, usingFallback]);

  const closeForwardSheet = useCallback(() => {
    if (forwardSubmitting) return;
    resetForwardState();
  }, [forwardSubmitting, resetForwardState]);

  const handleForwardSelectedMessage = useCallback(async () => {
    if (!forwardSourceMessages.length || usingFallback) return;
    if (!forwardSelectedChatIds.length) {
      setErrorText('Выбери хотя бы один чат для пересылки.');
      return;
    }
    setForwardSubmitting(true);
    try {
      const response = await fetch('/api/messages/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageIds: forwardSourceMessages.map((item) => item.id).filter(Boolean),
          conversationIds: forwardSelectedChatIds,
          comment: forwardComment,
        }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload) throw new Error(payload?.error || 'Не удалось переслать сообщение.');
      const deliveries = Array.isArray(payload.deliveries) ? payload.deliveries : [];
      const activeDelivery = deliveries.find((item) => item.conversation_id === activeChatId);
      if (activeDelivery?.messages?.length) {
        setMessages((prev) => mergeMessages(prev, activeDelivery.messages, 'append'));
      }
      scheduleChatsRefresh(activeChatId || activeChat?.id || null);
      const sourceCount = forwardSourceMessages.length;
      setSelectedMessageId(null);
      resetSelectionState();
      resetForwardState();
      const targetCount = Number(payload.target_count) || forwardSelectedChatIds.length;
      const sourceLabel = sourceCount > 1 ? 'Сообщения пересланы' : 'Сообщение переслано';
      setErrorText(targetCount > 1 ? `${sourceLabel} в ${targetCount} чата.` : `${sourceLabel}.`);
    } catch (error) {
      console.error('chat message forward failed', error);
      setErrorText(error?.message || 'Не удалось переслать сообщение.');
    } finally {
      setForwardSubmitting(false);
    }
  }, [activeChat?.id, activeChatId, forwardComment, forwardSelectedChatIds, forwardSourceMessages, mergeMessages, readJsonSafe, resetForwardState, resetSelectionState, scheduleChatsRefresh, setErrorText, setMessages, setSelectedMessageId, usingFallback]);

  const handleBatchToggleSaveSelectedMessages = useCallback(async (shouldSave = true) => {
    if (usingFallback || messageBatchActionLoading) return;
    const targetMessages = shouldSave ? selectedSavableMessages : selectedUnsavableMessages;
    const targetIds = targetMessages.map((item) => item.id).filter(Boolean);
    if (!targetIds.length) return;
    setMessageBatchActionLoading(true);
    try {
      const response = await fetch('/api/messages/save/batch', {
        method: shouldSave ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: targetIds }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload) throw new Error(payload?.error || (shouldSave ? 'Не удалось сохранить сообщения.' : 'Не удалось убрать сообщения из сохранённых.'));
      if (Array.isArray(payload.messages) && payload.messages.length) {
        setMessages((prev) => mergeMessages(prev, payload.messages, 'append'));
      }
      setSelectedMessageId(null);
      const failedIds = Array.isArray(payload.failed) ? payload.failed.map((item) => String(item?.id || '')).filter(Boolean) : [];
      const total = Number(payload.updatedCount) || targetIds.length;
      if (failedIds.length) {
        setMessageSelectionMode(true);
        setSelectedMessageIds(failedIds);
        setMessageSelectionNotice(failedIds.length > 1
          ? `Не обработано сообщений: ${failedIds.length}. Они оставлены выделенными.`
          : 'Одно сообщение не обработано и оставлено выделенным.');
        setErrorText(`${shouldSave ? 'Обработано' : 'Обновлено'}: ${total}. Ошибок: ${failedIds.length}.`);
      } else {
        resetSelectionState();
        setErrorText(total > 1
          ? (shouldSave ? `Сохранено сообщений: ${total}.` : `Убрано из сохранённых: ${total}.`)
          : (shouldSave ? 'Сообщение сохранено.' : 'Сообщение убрано из сохранённых.'));
      }
    } catch (error) {
      console.error('chat batch save toggle failed', error);
      setErrorText(error?.message || (shouldSave ? 'Не удалось сохранить сообщения.' : 'Не удалось убрать сообщения из сохранённых.'));
    } finally {
      setMessageBatchActionLoading(false);
    }
  }, [mergeMessages, messageBatchActionLoading, readJsonSafe, resetSelectionState, selectedSavableMessages, selectedUnsavableMessages, setErrorText, setMessages, setSelectedMessageId, usingFallback]);

  const handleBatchDeleteSelectedMessages = useCallback(async () => {
    if (usingFallback || messageBatchActionLoading) return;
    if (!selectedDeletableMessages.length) return;
    const remoteIds = [];
    const localIds = [];
    selectedDeletableMessages.forEach((item) => {
      const targetId = messageIdentity(item);
      if (!targetId) return;
      if (targetId.startsWith('local:') && item?.state === 'failed') localIds.push(targetId);
      else remoteIds.push(targetId);
    });
    const totalCount = localIds.length + remoteIds.length;
    const confirmLabel = totalCount > 1 ? `Удалить выбранные сообщения (${totalCount})?` : 'Удалить выбранное сообщение?';
    if (typeof window !== 'undefined' && !window.confirm(confirmLabel)) return;
    setMessageBatchActionLoading(true);
    try {
      if (localIds.length) {
        const localItems = selectedDeletableMessages.filter((item) => localIds.includes(messageIdentity(item)));
        await Promise.all(localItems.map((item) => item?.media?.url ? releaseChatMediaUpload(item.media, { silent: true }) : Promise.resolve(false)));
        setMessages((prev) => prev.filter((item) => !localIds.includes(messageIdentity(item))));
      }
      let deletedRemoteCount = 0;
      let failedRemoteCount = 0;
      let failedRemoteIds = [];
      let removedRemoteIds = [];
      if (remoteIds.length) {
        const response = await fetch('/api/messages/delete/batch', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageIds: remoteIds }),
        });
        const payload = await readJsonSafe(response);
        if (!response.ok || !payload) throw new Error(payload?.error || 'Не удалось удалить выбранные сообщения.');
        failedRemoteIds = Array.isArray(payload.failed) ? payload.failed.map((item) => String(item?.id || '')).filter(Boolean) : [];
        deletedRemoteCount = Number(payload.deletedCount) || Math.max(0, remoteIds.length - failedRemoteIds.length);
        removedRemoteIds = remoteIds.filter((id) => !failedRemoteIds.includes(String(id)));
      }
      const removedIds = [...localIds, ...removedRemoteIds];
      if (removedIds.length) {
        setMessages((prev) => scrubMessageRelations(prev.filter((item) => !removedIds.includes(messageIdentity(item))), removedIds));
      }
      const removedCount = removedIds.length || (localIds.length + deletedRemoteCount);
      if (editingMessageId && [...localIds, ...remoteIds].includes(String(editingMessageId))) {
        setComposerMode('send');
        setEditingMessageId(null);
      }
      if (replyingTo && [...localIds, ...remoteIds].includes(String(replyingTo.id || ''))) {
        setReplyingTo(null);
      }
      setSelectedMessageId(null);
      scheduleChatsRefresh(activeChatId || activeChat?.id || null);
      if (failedRemoteCount > 0) {
        setMessageSelectionMode(true);
        setSelectedMessageIds(failedRemoteIds);
        setMessageSelectionNotice(failedRemoteIds.length > 1
          ? `Не удалено сообщений: ${failedRemoteIds.length}. Они оставлены выделенными.`
          : 'Одно сообщение не удалось удалить, оно оставлено выделенным.');
        setErrorText(`Удалено: ${removedCount}. Ошибок: ${failedRemoteCount}.`);
      } else {
        resetSelectionState();
        setErrorText(removedCount > 1 ? `Удалено сообщений: ${removedCount}.` : 'Сообщение удалено.');
      }
    } catch (error) {
      console.error('chat batch delete failed', error);
      setErrorText(error?.message || 'Не удалось удалить выбранные сообщения.');
    } finally {
      setMessageBatchActionLoading(false);
    }
  }, [activeChat?.id, activeChatId, editingMessageId, mergeMessages, messageBatchActionLoading, readJsonSafe, releaseChatMediaUpload, replyingTo, resetSelectionState, scheduleChatsRefresh, selectedDeletableMessages, setComposerMode, setEditingMessageId, setErrorText, setMessages, setReplyingTo, setSelectedMessageId, usingFallback]);

  return {
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
    messageSelectionNotice: messageSelectionNotice || encryptedSelectionHint,
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
  };
}

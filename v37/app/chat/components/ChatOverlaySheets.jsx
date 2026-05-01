'use client';

import { useEffect, useState } from 'react';
import { canBatchSelectMessage, mediaPreviewLabel } from './chatViewPrimitives';
import { getMessageCapabilities } from '../lib/messageCapabilities';


function ReplyActionIcon() { return <svg viewBox="0 0 24 24"><path d="m10 9-5 4 5 4" /><path d="M20 5v6a4 4 0 0 1-4 4H5" /></svg>; }
function CopyActionIcon() { return <svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" /></svg>; }
function ForwardActionIcon() { return <svg viewBox="0 0 24 24"><path d="M14 4l7 8-7 8" /><path d="M21 12H8a5 5 0 0 0-5 5v3" /></svg>; }
function SelectActionIcon() { return <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></svg>; }
function EditActionIcon() { return <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>; }
function SaveActionIcon() { return <svg viewBox="0 0 24 24"><path d="M6 4h9l3 3v13H6z" /><path d="M9 4v5h6V4" /><path d="M9 16h6" /></svg>; }
function PinActionIcon() { return <svg viewBox="0 0 24 24"><path d="m12 17-4 4" /><path d="m15 3 6 6" /><path d="M8 10 3 15" /><path d="m14 4 6 6-8.5 8.5a2.12 2.12 0 0 1-3 0l-3-3a2.12 2.12 0 0 1 0-3Z" /></svg>; }
function ReportActionIcon() { return <svg viewBox="0 0 24 24"><path d="M4 4h10l-1 4 3 2-1 4H4" /><path d="M4 22V4" /></svg>; }
function DeleteActionIcon() { return <svg viewBox="0 0 24 24"><path d="M4 7h16" /><path d="M9 7V5h6v2" /><path d="M7 7l1 12h8l1-12" /></svg>; }
function MoreActionIcon() { return <svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" /></svg>; }
function actionIconForKey(key) {
  switch (key) {
    case 'retry': return <ReplyActionIcon />;
    case 'reply': return <ReplyActionIcon />;
    case 'copy': return <CopyActionIcon />;
    case 'forward': return <ForwardActionIcon />;
    case 'select-more': return <SelectActionIcon />;
    case 'edit': return <EditActionIcon />;
    case 'save': return <SaveActionIcon />;
    case 'pin': return <PinActionIcon />;
    case 'report': return <ReportActionIcon />;
    case 'delete': return <DeleteActionIcon />;
    default: return <MoreActionIcon />;
  }
}


export default function ChatOverlaySheets({
  forwardSheetOpen,
  forwardSourceMessages,
  closeForwardSheet,
  forwardTargetsQuery,
  setForwardTargetsQuery,
  selectedMessage,
  selectedMessageActionText,
  selectedMessagePreviewItems,
  messageActionLoading,
  composerMode,
  closeSelectedMessage,
  handleRetryMessage,
  beginReplyMessage,
  handleCopyMessage,
  openForwardSheet,
  beginMultiMessageSelection,
  beginEditMessage,
  handleToggleSaveMessage,
  handleTogglePinMessage,
  handleReportSelectedMessage,
  handleDeleteMessage,
  forwardTargetChats,
  forwardSelectedChatIds,
  toggleForwardChatSelection,
  forwardComment,
  setForwardComment,
  handleForwardSelectedMessage,
  forwardSubmitting,
  pinnedPanelOpen,
  closePinnedPanel,
  pinnedMessages,
  activePinnedEntry,
  setPinnedCurrentIndex,
  openPinnedMessage,
  attachmentSheetOpen,
  setAttachmentSheetOpen,
  launchAttachmentPicker,
  handleQuickReact,
  disableMessageActions,
  messageSelectionMode = false,
  selectedMessages = [],
}) {
  const [showMoreActions, setShowMoreActions] = useState(false);
  const messageCapabilities = getMessageCapabilities(selectedMessage);
  const quickReactions = ['❤️', '👍', '😂', '😮', '😢'];
  const primaryActions = [
    selectedMessage?.state === 'failed' ? { key: 'retry', onClick: () => { handleRetryMessage(); closeSelectedMessage(); }, disabled: messageActionLoading, label: 'Повторить' } : null,
    messageCapabilities.canReply && selectedMessage?.state !== 'failed' ? { key: 'reply', onClick: () => { beginReplyMessage(); closeSelectedMessage(); }, disabled: messageActionLoading || composerMode === 'edit', label: 'Ответить' } : null,
    messageCapabilities.canCopy ? { key: 'copy', onClick: () => { handleCopyMessage(); }, disabled: messageActionLoading, label: 'Копировать' } : null,
    messageCapabilities.canForward ? { key: 'forward', onClick: () => { openForwardSheet(); closeSelectedMessage(); }, disabled: messageActionLoading || forwardSubmitting, label: 'Переслать' } : null,
    canBatchSelectMessage(selectedMessage) ? { key: 'select-more', onClick: () => { beginMultiMessageSelection(); closeSelectedMessage(); }, disabled: messageActionLoading || forwardSubmitting, label: 'Выбрать' } : null,
  ].filter(Boolean);
  const secondaryActions = [
    messageCapabilities.canEdit ? { key: 'edit', onClick: () => { beginEditMessage(); closeSelectedMessage(); }, disabled: messageActionLoading, label: 'Изменить' } : null,
    messageCapabilities.canSave ? { key: 'save', onClick: () => { handleToggleSaveMessage(); }, disabled: messageActionLoading, label: selectedMessage?.is_saved ? 'Убрать из сохранённых' : 'Сохранить' } : null,
    messageCapabilities.canPin ? { key: 'pin', onClick: () => { handleTogglePinMessage(); }, disabled: messageActionLoading, label: selectedMessage?.is_pinned ? 'Открепить' : 'Закрепить' } : null,
    messageCapabilities.canReport ? { key: 'report', onClick: () => { handleReportSelectedMessage(); }, disabled: messageActionLoading, label: 'Пожаловаться', warn: true } : null,
  ].filter(Boolean);
  const dangerAction = messageCapabilities.canDelete ? { key: 'delete', onClick: () => { handleDeleteMessage(); }, disabled: messageActionLoading, label: selectedMessage?.state === 'failed' ? 'Убрать' : 'Удалить', danger: true } : null;
  const visibleActions = showMoreActions ? secondaryActions : primaryActions;
  const canShowMoreToggle = !showMoreActions && secondaryActions.length > 0;
  const messageSheetClassName = `chatW-messageSheet ${selectedMessage?.direction === 'outgoing' ? 'is-outgoing' : 'is-incoming'}${showMoreActions ? ' is-more-open' : ''}`;
  const previewEyebrow = selectedMessage?.is_mine || selectedMessage?.direction === 'outgoing' ? 'Ваше сообщение' : (selectedMessage?.sender?.name || 'Сообщение');
  const previewMeta = [
    selectedMessage?.time || '',
    selectedMessage?.is_encrypted || selectedMessage?.isEncrypted ? 'Защищено' : '',
    selectedMessage?.type && !['text', 'encrypted'].includes(selectedMessage.type) ? mediaPreviewLabel(selectedMessage.type, selectedMessage.media) : '',
  ].filter(Boolean);

  const selectedMessageEncryptedHint = selectedMessage?.is_encrypted || selectedMessage?.isEncrypted
    ? 'Это защищённое сообщение. Можно ответить, скопировать, сохранить или удалить его, но пересылка и изменение отключены. Текст также не участвует в поиске по переписке.'
    : '';
  const encryptedSelectedCount = Array.isArray(selectedMessages)
    ? selectedMessages.filter((item) => item?.is_encrypted || item?.isEncrypted).length
    : 0;
  const forwardableSelectedCount = Array.isArray(forwardSourceMessages) ? forwardSourceMessages.length : 0;
  const selectionForwardHint = messageSelectionMode && selectedMessages.length && encryptedSelectedCount
    ? (forwardableSelectedCount
      ? `Из ${selectedMessages.length} выбранных сообщений переслать получится ${forwardableSelectedCount}. Защищённые сообщения останутся только в этом чате.`
      : `Выбраны только защищённые сообщения (${selectedMessages.length}). Их можно сохранить или удалить, но нельзя переслать.`)
    : '';

  useEffect(() => {
    setShowMoreActions(false);
  }, [selectedMessage?.id]);

  return (
    <>
      {selectedMessage && !disableMessageActions ? (
        <div className="chatW-messageSheetBackdrop" onClick={closeSelectedMessage}>
          <div className={messageSheetClassName} role="dialog" aria-modal="true" aria-label={selectedMessageActionText || 'Действия с сообщением'} onClick={(event) => event.stopPropagation()}>
            {messageCapabilities.canReact ? (
              <div className="chatW-messageSheetReactions">
                {quickReactions.map((emoji) => {
                  const isActive = Array.isArray(selectedMessage?.reactions) && selectedMessage.reactions.some((entry) => entry?.emoji === emoji && entry?.reacted_by_me);
                  return (
                    <button
                      key={emoji}
                      type="button"
                      className={`chatW-messageReactionChip ${isActive ? 'is-active' : ''}`}
                      onClick={() => { handleQuickReact?.(selectedMessage, emoji); closeSelectedMessage(); }}
                      disabled={messageActionLoading}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {visibleActions.length || canShowMoreToggle || dangerAction || selectedMessageEncryptedHint ? (
              <div className="chatW-messageSheetMenu">
                <div className="chatW-messageSheetPreviewCard">
                  <div className="chatW-messageSheetEyebrow">{previewEyebrow}</div>
                  <div className="chatW-messageSheetPreviewText">{selectedMessageActionText || 'Сообщение'}</div>
                  {previewMeta.length ? (
                    <div className="chatW-messageSheetMeta">
                      {previewMeta.map((item) => <span key={item}>{item}</span>)}
                    </div>
                  ) : null}
                </div>
                {selectedMessageEncryptedHint ? <div className="chatW-messageSheetHint">{selectedMessageEncryptedHint}</div> : null}
                <div className="chatW-messageSheetList">
                  {visibleActions.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      className={`chatW-messageSheetAction ${action.warn ? 'is-warn' : ''}`}
                      onClick={action.onClick}
                      disabled={action.disabled}
                    >
                      <span className="chatW-messageSheetActionIcon">{actionIconForKey(action.key)}</span>
                      <span>{action.label}</span>
                    </button>
                  ))}
                  {canShowMoreToggle ? (
                    <button
                      type="button"
                      className="chatW-messageSheetAction is-secondary"
                      onClick={() => setShowMoreActions(true)}
                      disabled={messageActionLoading}
                    >
                      <span className="chatW-messageSheetActionIcon">{actionIconForKey('more')}</span>
                      <span>Ещё действия</span>
                    </button>
                  ) : null}
                </div>
                {dangerAction ? (
                  <>
                    <div className="chatW-messageSheetDivider" aria-hidden="true" />
                    <button
                      type="button"
                      className="chatW-messageSheetAction is-danger"
                      onClick={dangerAction.onClick}
                      disabled={dangerAction.disabled}
                    >
                      <span className="chatW-messageSheetActionIcon">{actionIconForKey('delete')}</span>
                      <span>{dangerAction.label}</span>
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}


      {forwardSheetOpen && forwardSourceMessages.length ? (
        <div className="chatW-forwardBackdrop" onClick={closeForwardSheet}>
          <div className="chatW-forwardSheet" role="dialog" aria-modal="true" aria-label="Переслать сообщение" onClick={(event) => event.stopPropagation()}>
            <div className="chatW-forwardHead">
              <div>
                <div className="chatW-forwardTitle">{forwardSourceMessages.length > 1 ? 'Переслать сообщения' : 'Переслать сообщение'}</div>
                <div className="chatW-forwardText">Можно выбрать один или несколько чатов.</div>
              </div>
              <button type="button" className="chatW-forwardClose" onClick={closeForwardSheet} aria-label="Закрыть">×</button>
            </div>
            <div className="chatW-forwardSearch">
              <input
                type="text"
                placeholder="Найти чат"
                value={forwardTargetsQuery}
                onChange={(event) => setForwardTargetsQuery(event.target.value)}
              />
            </div>
            <div className="chatW-forwardPreview">
              <strong>{forwardSourceMessages.length > 1 ? `Выбрано сообщений: ${forwardSourceMessages.length}` : (selectedMessage?.sender?.name || (selectedMessage?.is_mine ? 'Вы' : 'Пользователь'))}</strong>
              <span>{selectedMessagePreviewItems.join(' • ')}</span>
              {selectionForwardHint ? <em className="chatW-forwardHint">{selectionForwardHint}</em> : null}
            </div>
            <div className="chatW-forwardList">
              {forwardTargetChats.length ? forwardTargetChats.map((chat) => {
                const checked = forwardSelectedChatIds.includes(chat.id);
                return (
                  <label key={chat.id} className={`chatW-forwardItem ${checked ? 'is-selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleForwardChatSelection(chat.id)}
                    />
                    <div className="chatW-forwardItemMain">
                      <strong>{chat.name}</strong>
                      <span>{chat.status || chat.preview || 'Диалог'}</span>
                    </div>
                  </label>
                );
              }) : <div className="chatW-forwardEmpty">Ничего не найдено.</div>}
            </div>
            <div className="chatW-forwardComment">
              <textarea
                rows={3}
                placeholder="Комментарий перед пересылкой (необязательно)"
                value={forwardComment}
                onChange={(event) => setForwardComment(event.target.value)}
              />
            </div>
            <div className="chatW-forwardActions">
              <button type="button" className="chatW-forwardCancel" onClick={closeForwardSheet} disabled={forwardSubmitting}>Отмена</button>
              <button type="button" className="chatW-forwardSubmit" onClick={handleForwardSelectedMessage} disabled={forwardSubmitting || !forwardSelectedChatIds.length}>{forwardSubmitting ? 'Пересылаем…' : 'Переслать'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {pinnedPanelOpen ? (
        <div className="chatW-forwardBackdrop" onClick={closePinnedPanel}>
          <div className="chatW-forwardSheet chatW-pinnedSheet" role="dialog" aria-modal="true" aria-label="Закреплённые сообщения" onClick={(event) => event.stopPropagation()}>
            <div className="chatW-forwardHead">
              <div>
                <div className="chatW-forwardTitle">Закреплённые сообщения</div>
                <div className="chatW-forwardText">Быстрый переход к важным сообщениям в этом чате.</div>
              </div>
              <button type="button" className="chatW-forwardClose" onClick={closePinnedPanel} aria-label="Закрыть">×</button>
            </div>
            <div className="chatW-pinnedList">
              {pinnedMessages.length ? pinnedMessages.map((entry, index) => {
                const isActive = entry.message?.id && entry.message.id === activePinnedEntry?.message?.id;
                return (
                  <button
                    key={entry.id || entry.message?.id || index}
                    type="button"
                    className={`chatW-pinnedItem ${isActive ? 'is-active' : ''}`}
                    onClick={() => { setPinnedCurrentIndex(index); openPinnedMessage(entry.message?.id); }}
                  >
                    <strong>{entry.message?.sender?.name || 'Пользователь'}</strong>
                    <span>{entry.message?.forwarded_from?.preview_text || entry.message?.text || entry.message?.preview_text || mediaPreviewLabel(entry.message?.type, entry.message?.media)}</span>
                    <em>{entry.message?.time || ''}</em>
                  </button>
                );
              }) : <div className="chatW-forwardEmpty">Пока нет закреплённых сообщений.</div>}
            </div>
          </div>
        </div>
      ) : null}

      {attachmentSheetOpen ? (
        <div className="chatW-attachsheet-backdrop" onClick={() => setAttachmentSheetOpen(false)}>
          <div className="chatW-attachsheet" role="dialog" aria-modal="true" aria-label="Добавить вложение" onClick={(event) => event.stopPropagation()}>
            <div className="chatW-attachsheet-head">
              <div>
                <div className="chatW-attachsheet-title">Вложения</div>
              </div>
              <button type="button" className="chatW-attachsheet-close" onClick={() => setAttachmentSheetOpen(false)} aria-label="Закрыть">×</button>
            </div>
            <div className="chatW-attachsheet-grid">
              <button type="button" className="chatW-attachsheet-option" onClick={() => launchAttachmentPicker({ kind: 'image', accept: 'image/*' })}>
                <span className="chatW-attachsheet-option-title">Фото</span>
                <span className="chatW-attachsheet-option-text">Можно выбрать несколько</span>
              </button>
              <button type="button" className="chatW-attachsheet-option" onClick={() => launchAttachmentPicker({ kind: 'video', accept: 'video/*' })}>
                <span className="chatW-attachsheet-option-title">Видео</span>
                <span className="chatW-attachsheet-option-text">Можно выбрать несколько</span>
              </button>
              <button type="button" className="chatW-attachsheet-option chatW-attachsheet-option-full" onClick={() => launchAttachmentPicker({ kind: 'file', accept: '*' })}>
                <span className="chatW-attachsheet-option-title">Файл</span>
                <span className="chatW-attachsheet-option-text">Можно выбрать несколько</span>
              </button>
            </div>
            <button type="button" className="chatW-attachsheet-cancel" onClick={() => setAttachmentSheetOpen(false)}>Отмена</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function getMessageCapabilities(message, context = {}) {
  if (!message) {
    return {
      canReply: false,
      canReact: false,
      canForward: false,
      canSave: false,
      canDelete: false,
      canReport: false,
      canPin: false,
      canOpenMedia: false,
      canPlayInline: false,
      canSwipeReply: false,
      canDoubleTapReact: false,
      canLongPressActions: false,
      actionCount: 0,
    };
  }

  const type = String(message.type || 'text').toLowerCase();
  const isDeleted = Boolean(message.deleted);
  const isSending = message.state === 'sending';
  const isFailed = message.state === 'failed';
  const hasMediaUrl = Boolean(message.media?.url);
  const isMedia = ['image', 'video', 'voice', 'video_note', 'file'].includes(type);
  const isSystemLike = ['system', 'divider', 'call_event'].includes(type);
  const isMine = Boolean(message.is_mine || message.direction === 'outgoing');
  const localOnly = String(message.id || message.client_id || '').startsWith('local:');

  const canReply = message.can_reply !== false && !isDeleted && !isSending;
  const canForward = Boolean(message.can_forward) && !isDeleted && !isSending && !isFailed;
  const canSave = message.can_save !== false && !isDeleted && !isSending && !isFailed && !localOnly;
  const canDelete = Boolean(message.can_delete) && !isDeleted;
  const canReport = Boolean(message.can_report) && !message.reported_by_me && !isMine && !isDeleted;
  const canPin = Boolean(message.can_pin) && !isDeleted && !isSending && !isFailed && !localOnly;
  const canCopy = message.can_copy !== false && !isDeleted;
  const canEdit = Boolean(message.can_edit) && !isDeleted && !isSending && ['text', 'system'].includes(type);
  const canOpenMedia = hasMediaUrl && ['image', 'video'].includes(type);
  const isStoryMessage = ['story_reply', 'shared_story'].includes(type) || Boolean(message.story_ref);
  const canOpenStory = isStoryMessage && Boolean(message.story_ref?.story_id || message.story_ref?.item_id || message.story_ref?.preview_url || message.story_ref?.deep_link);
  const canPlayInline = hasMediaUrl && ['voice', 'video_note'].includes(type);
  const canReact = !isDeleted && !isSending && !isSystemLike;
  const canSwipeReply = canReply && !isSystemLike;
  const canDoubleTapReact = canReact && !canPlayInline && !canOpenMedia;
  const canLongPressActions = !isSystemLike || canDelete || canReply || canForward || canSave || canPin || canReport;

  const actionCount = [
    isFailed,
    canReply,
    canCopy,
    canForward,
    canEdit,
    canSave,
    canPin,
    canReport,
    canDelete,
  ].filter(Boolean).length;

  return {
    type,
    isMedia,
    isSystemLike,
    isStoryMessage,
    isMine,
    canReply,
    canReact,
    canForward,
    canSave,
    canDelete,
    canReport,
    canPin,
    canCopy,
    canEdit,
    canOpenMedia,
    canOpenStory,
    canPlayInline,
    canSwipeReply,
    canDoubleTapReact,
    canLongPressActions,
    actionCount,
    showActionTrigger: canLongPressActions && actionCount > 0,
    context,
  };
}

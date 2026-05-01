'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_CONFIG = {
  longPressDelay: 420,
  moveCancelThreshold: 10,
  doubleTapDelay: 260,
  swipeReplyThreshold: 72,
  swipePreviewMax: 92,
  swipeVerticalTolerance: 18,
};

function getPoint(event) {
  return {
    x: Number(event?.clientX || 0),
    y: Number(event?.clientY || 0),
  };
}

export function useMessageInteractions({
  item,
  interactionMode = 'normal',
  capabilities,
  isInteractiveTarget,
  onOpenActions,
  onToggleSelection,
  onQuickReact,
  onPrimaryTap,
  onSwipeReply,
  config = DEFAULT_CONFIG,
}) {
  const longPressTimeoutRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const swipeTriggeredRef = useRef(false);
  const pointerStartRef = useRef(null);
  const lastTapRef = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isPressing, setIsPressing] = useState(false);

  const messageSelectionMode = interactionMode === 'selection';

  const clearLongPress = useCallback(() => {
    if (longPressTimeoutRef.current) {
      window.clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  useEffect(() => {
    if (interactionMode !== 'selection') return;
    clearLongPress();
    longPressTriggeredRef.current = false;
    swipeTriggeredRef.current = false;
    pointerStartRef.current = null;
    setSwipeOffset(0);
    setIsPressing(false);
  }, [clearLongPress, interactionMode]);

  const openActions = useCallback(() => {
    if (!capabilities?.canLongPressActions) return;
    onOpenActions?.(item);
  }, [capabilities?.canLongPressActions, item, onOpenActions]);

  const onPointerDown = useCallback((event) => {
    if (messageSelectionMode) return;
    if (isInteractiveTarget?.(event.target)) return;
    longPressTriggeredRef.current = false;
    swipeTriggeredRef.current = false;
    setSwipeOffset(0);
    setIsPressing(Boolean(capabilities?.canLongPressActions));
    pointerStartRef.current = getPoint(event);
    clearLongPress();
    if (capabilities?.canLongPressActions) {
      longPressTimeoutRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true;
        setIsPressing(false);
        openActions();
      }, config.longPressDelay);
    }
  }, [capabilities?.canLongPressActions, clearLongPress, config.longPressDelay, isInteractiveTarget, messageSelectionMode, openActions]);

  const onPointerMove = useCallback((event) => {
    if (!pointerStartRef.current) return;
    const next = getPoint(event);
    const deltaX = next.x - pointerStartRef.current.x;
    const deltaY = next.y - pointerStartRef.current.y;
    if (Math.abs(deltaX) > config.moveCancelThreshold || Math.abs(deltaY) > config.moveCancelThreshold) {
      clearLongPress();
      if (isPressing) setIsPressing(false);
    }
    if (!capabilities?.canSwipeReply) return;
    if (deltaX <= 0 || Math.abs(deltaY) > config.swipeVerticalTolerance) {
      if (swipeOffset) setSwipeOffset(0);
      return;
    }
    const nextOffset = Math.min(config.swipePreviewMax, deltaX);
    if (nextOffset !== swipeOffset) setSwipeOffset(nextOffset);
  }, [capabilities?.canSwipeReply, clearLongPress, config.moveCancelThreshold, config.swipePreviewMax, config.swipeVerticalTolerance, isPressing, swipeOffset]);

  const onPointerEnd = useCallback(() => {
    const shouldReply = capabilities?.canSwipeReply && swipeOffset >= config.swipeReplyThreshold;
    pointerStartRef.current = null;
    clearLongPress();
    setSwipeOffset(0);
    setIsPressing(false);
    if (shouldReply) {
      swipeTriggeredRef.current = true;
      onSwipeReply?.(item);
    }
  }, [capabilities?.canSwipeReply, clearLongPress, config.swipeReplyThreshold, item, onSwipeReply, swipeOffset]);

  const onClick = useCallback((event) => {
    if (messageSelectionMode) {
      onToggleSelection?.(item, { silentBlocked: true });
      return;
    }
    if (isInteractiveTarget?.(event.target)) return;
    if (longPressTriggeredRef.current || swipeTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      swipeTriggeredRef.current = false;
      event.preventDefault();
      return;
    }
    const now = Date.now();
    const isDoubleTap = capabilities?.canDoubleTapReact && now - lastTapRef.current <= config.doubleTapDelay;
    lastTapRef.current = now;
    if (isDoubleTap) {
      onQuickReact?.(item, '❤️');
      return;
    }
    onPrimaryTap?.(item, event);
  }, [capabilities?.canDoubleTapReact, config.doubleTapDelay, isInteractiveTarget, item, messageSelectionMode, onPrimaryTap, onQuickReact, onToggleSelection]);

  const onActionTriggerClick = useCallback((event) => {
    event.stopPropagation();
    openActions();
  }, [openActions]);

  return {
    bubbleBindings: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerLeave: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onClick,
    },
    actionTriggerBindings: {
      onClick: onActionTriggerClick,
    },
    clearLongPress,
    interactionState: {
      swipeOffset,
      isSwiping: swipeOffset > 0,
      isPressing,
      showSwipeReplyHint: capabilities?.canSwipeReply && swipeOffset >= config.swipeReplyThreshold / 2,
    },
  };
}

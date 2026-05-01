'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function useMessengerOverlayRuntime({
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
}) {
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false);
  const chatMenuWrapRef = useRef(null);

  useEffect(() => {
    setChatMenuOpen(false);
    setPinnedPanelOpen(false);
  }, [activeChatId]);

  useEffect(() => {
    if (!chatMenuOpen) return undefined;

    const onPointerDown = (event) => {
      if (!chatMenuWrapRef.current?.contains?.(event.target)) {
        setChatMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [chatMenuOpen]);

  useEffect(() => {
    if (!pinnedMessages.length && pinnedPanelOpen) {
      setPinnedPanelOpen(false);
    }
    if (!pinnedMessages.length) return;
    if (pinnedCurrentIndex < pinnedMessages.length) return;
    setPinnedCurrentIndex(Math.max(0, pinnedMessages.length - 1));
  }, [pinnedCurrentIndex, pinnedMessages.length, pinnedPanelOpen, setPinnedCurrentIndex]);

  const activePinnedEntry = useMemo(() => {
    if (!pinnedMessages.length) return null;
    const safeIndex = Math.min(Math.max(pinnedCurrentIndex, 0), pinnedMessages.length - 1);
    return pinnedMessages[safeIndex] || null;
  }, [pinnedCurrentIndex, pinnedMessages]);

  const toggleChatMenu = useCallback(() => {
    setChatMenuOpen((prev) => {
      const next = !prev;
      if (next) setPinnedPanelOpen(false);
      return next;
    });
  }, []);

  const closeChatMenu = useCallback(() => {
    setChatMenuOpen(false);
  }, []);

  const openPinnedPanel = useCallback(() => {
    if (!pinnedMessages.length) return;
    setChatMenuOpen(false);
    setPinnedPanelOpen(true);
  }, [pinnedMessages.length]);

  const closePinnedPanel = useCallback(() => {
    setPinnedPanelOpen(false);
  }, []);

  const openPinnedMessage = useCallback(async (messageId) => {
    if (!messageId) return;
    const ok = await loadMessageContextIntoTimeline(messageId, { select: true });
    if (ok) setPinnedPanelOpen(false);
  }, [loadMessageContextIntoTimeline]);

  const stepPinnedMessage = useCallback((direction = 1) => {
    if (!pinnedMessages.length) return;
    setPinnedCurrentIndex((prev) => (prev + direction + pinnedMessages.length) % pinnedMessages.length);
  }, [pinnedMessages.length, setPinnedCurrentIndex]);

  useEffect(() => {
    const hasBlockingOverlay = Boolean(forwardSheetOpen || attachmentSheetOpen || pinnedPanelOpen);
    if (!hasBlockingOverlay || typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [attachmentSheetOpen, forwardSheetOpen, pinnedPanelOpen]);

  useEffect(() => {
    const hasOverlay = Boolean(chatMenuOpen || pinnedPanelOpen || attachmentSheetOpen || forwardSheetOpen);
    if (!hasOverlay || typeof window === 'undefined') return undefined;

    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (forwardSheetOpen) {
        if (!forwardSubmitting) closeForwardSheet();
        return;
      }
      if (attachmentSheetOpen) {
        setAttachmentSheetOpen(false);
        return;
      }
      if (pinnedPanelOpen) {
        setPinnedPanelOpen(false);
        return;
      }
      if (chatMenuOpen) {
        setChatMenuOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [attachmentSheetOpen, chatMenuOpen, closeForwardSheet, forwardSheetOpen, forwardSubmitting, pinnedPanelOpen, setAttachmentSheetOpen]);

  return {
    chatMenuOpen,
    setChatMenuOpen,
    toggleChatMenu,
    closeChatMenu,
    chatMenuWrapRef,
    pinnedPanelOpen,
    setPinnedPanelOpen,
    openPinnedPanel,
    closePinnedPanel,
    activePinnedEntry,
    openPinnedMessage,
    stepPinnedMessage,
  };
}

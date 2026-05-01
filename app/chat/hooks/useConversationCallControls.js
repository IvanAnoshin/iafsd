'use client';

import { useCallback, useMemo, useState } from 'react';

export function useConversationCallControls({
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
}) {
  const [callActionLoading, setCallActionLoading] = useState(false);

  const callStartDisabled = useMemo(
    () => !activeChatId || usingFallback || composeBlockedByRequest || callActionLoading,
    [activeChatId, usingFallback, composeBlockedByRequest, callActionLoading],
  );

  const startConversationCall = useCallback(async (type = 'audio') => {
    if (!activeChatId || usingFallback || callActionLoading) return;
    setCallActionLoading(true);
    setErrorText('');
    try {
      if (type === 'video') {
        const diagnostics = await inspectVideoDevices().catch(() => null);
        if (diagnostics) {
          const availabilityMessage = getVideoRequirementError({
            audioInputCount: diagnostics.hasMicrophone ? 1 : 0,
            videoInputCount: diagnostics.hasCamera ? 1 : 0,
          }, 'call');
          if (availabilityMessage) {
            setVideoCallFallback({
              title: diagnostics.hasCamera ? 'Видеозвонок отключён в этой версии' : 'Камера не найдена',
              message: availabilityMessage,
            });
            throw new Error(availabilityMessage);
          }
        }
      }
      await ensureLocalCallStream(type);
      const response = await fetch('/api/chat/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeChatId, type }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.call) throw new Error(payload?.error || 'Не удалось начать звонок.');
      const nextCall = pickLiveCall(payload.call);
      emitMessengerTelemetry?.({
        category: 'call',
        metric: 'setup',
        outcome: nextCall ? 'success' : 'ended',
        callSessionId: nextCall?.id || null,
        conversationId: activeChatId,
        details: { type },
      });
      setActiveCall(nextCall);
      if (nextCall) {
        ensureCallConnection(nextCall, { offer: nextCall.viewer?.is_initiator });
      }
      scheduleChatsRefresh(activeChatId);
    } catch (error) {
      if (type === 'video' && (String(error?.name || '') === 'NotFoundError' || /Камера не найдена/i.test(String(error?.message || '')))) {
        setVideoCallFallback({
          title: 'Камера не найдена',
          message: 'Не удалось получить доступ к камере. Можно начать аудиозвонок или повторить поиск камеры.',
        });
      }
      if (!(String(error?.name || '') === 'NotAllowedError')) console.error('start call failed', error);
      emitMediaDeviceErrorTelemetry?.(error, { mode: 'call_start', type });
      emitMessengerTelemetry?.({
        category: 'call',
        metric: 'setup',
        outcome: 'error',
        conversationId: activeChatId,
        details: { type, error: error?.message || 'unknown_error' },
      });
      setErrorText(describeMediaPermissionError(error, { video: type === 'video', mode: 'call' }));
    } finally {
      setCallActionLoading(false);
    }
  }, [
    activeChatId,
    callActionLoading,
    describeMediaPermissionError,
    emitMediaDeviceErrorTelemetry,
    emitMessengerTelemetry,
    ensureCallConnection,
    ensureLocalCallStream,
    getVideoRequirementError,
    inspectVideoDevices,
    pickLiveCall,
    readJsonSafe,
    scheduleChatsRefresh,
    setActiveCall,
    setErrorText,
    setVideoCallFallback,
    usingFallback,
  ]);

  const startAudioFallbackCall = useCallback(async () => {
    setVideoCallFallback(null);
    await startConversationCall('audio');
  }, [setVideoCallFallback, startConversationCall]);

  const dismissVideoCallFallback = useCallback(() => {
    setVideoCallFallback(null);
  }, [setVideoCallFallback]);

  const handleCallAction = useCallback(async (action, extra = {}) => {
    if (!activeCall?.id || callActionLoading) return;
    setCallActionLoading(true);
    setErrorText('');
    try {
      if (action === 'accept') {
        if ((activeCall?.type || 'audio') === 'video') {
          const diagnostics = await inspectVideoDevices().catch(() => null);
          if (diagnostics) {
            const availabilityMessage = getVideoRequirementError({
              audioInputCount: diagnostics.hasMicrophone ? 1 : 0,
              videoInputCount: diagnostics.hasCamera ? 1 : 0,
            }, 'call');
            if (availabilityMessage) {
              throw new Error(availabilityMessage);
            }
          }
        }
        await ensureLocalCallStream(activeCall?.type || 'audio');
      }
      const response = await fetch(`/api/chat/calls/${activeCall.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.call) throw new Error(payload?.error || 'Не удалось обновить звонок.');
      const nextCall = pickLiveCall(payload.call);
      setActiveCall(nextCall);
      if (nextCall) {
        ensureCallConnection(nextCall, { offer: nextCall.viewer?.is_initiator });
      }
      scheduleChatsRefresh(activeChatId);
    } catch (error) {
      if (!(String(error?.name || '') === 'NotAllowedError')) console.error('call action failed', error);
      emitMediaDeviceErrorTelemetry?.(error, { mode: 'call_action', action, type: activeCall?.type || 'audio' });
      setErrorText(describeMediaPermissionError(error, { video: activeCall?.type === 'video', mode: 'call' }));
    } finally {
      setCallActionLoading(false);
    }
  }, [
    activeCall,
    activeChatId,
    callActionLoading,
    describeMediaPermissionError,
    emitMediaDeviceErrorTelemetry,
    ensureCallConnection,
    ensureLocalCallStream,
    getVideoRequirementError,
    inspectVideoDevices,
    pickLiveCall,
    readJsonSafe,
    scheduleChatsRefresh,
    setActiveCall,
    setErrorText,
  ]);

  const videoCallFallbackVisible = Boolean(videoCallFallback?.message);
  const canToggleCallMic = Boolean(callViewer?.can_toggle);
  const canToggleCallCamera = Boolean(callViewer?.can_toggle && activeCall?.type === 'video');

  return {
    callActionLoading,
    callStartDisabled,
    videoCallFallbackVisible,
    canToggleCallMic,
    canToggleCallCamera,
    startConversationCall,
    startAudioFallbackCall,
    dismissVideoCallFallback,
    handleCallAction,
  };
}

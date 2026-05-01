import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function useCallRuntime({
  usingFallback,
  readJsonSafe,
  requestMediaInput,
  emitMessengerTelemetry,
  normalizeActiveCall,
}) {
  const [activeCall, setActiveCall] = useState(null);
  const [callConfig, setCallConfig] = useState(null);
  const [callClientStatus, setCallClientStatus] = useState('');
  const [callClientError, setCallClientError] = useState('');
  const [localCallReady, setLocalCallReady] = useState(false);
  const [remoteCallReady, setRemoteCallReady] = useState(false);

  const localCallVideoRef = useRef(null);
  const remoteCallVideoRef = useRef(null);
  const remoteCallAudioRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localCallStreamRef = useRef(null);
  const remoteCallStreamRef = useRef(null);
  const pendingCallSignalsRef = useRef([]);
  const startedOfferForCallRef = useRef(null);
  const activeCallIdRef = useRef(null);
  const callRecoveryTimeoutRef = useRef(null);
  const callRecoveryAttemptRef = useRef(0);
  const callRefreshInFlightRef = useRef(false);
  const lastCallRefreshAtRef = useRef(0);
  const callMediaModeRef = useRef('audio');

  const refreshActiveCallStateRef = useRef(null);
  const ensureCallConnectionRef = useRef(null);
  const processIncomingCallSignalRef = useRef(null);
  const flushPendingCallSignalsRef = useRef(null);

  const resetCallMediaState = useCallback(() => {
    setCallClientStatus('');
    setCallClientError('');
    setLocalCallReady(false);
    setRemoteCallReady(false);
  }, []);

  const detachCallMediaElements = useCallback(() => {
    if (localCallVideoRef.current) localCallVideoRef.current.srcObject = null;
    if (remoteCallVideoRef.current) remoteCallVideoRef.current.srcObject = null;
    if (remoteCallAudioRef.current) remoteCallAudioRef.current.srcObject = null;
  }, []);

  const stopCallMedia = useCallback(() => {
    if (callRecoveryTimeoutRef.current) {
      window.clearTimeout(callRecoveryTimeoutRef.current);
      callRecoveryTimeoutRef.current = null;
    }
    if (peerConnectionRef.current) {
      try { peerConnectionRef.current.onicecandidate = null; } catch {}
      try { peerConnectionRef.current.ontrack = null; } catch {}
      try { peerConnectionRef.current.onconnectionstatechange = null; } catch {}
      try { peerConnectionRef.current.oniceconnectionstatechange = null; } catch {}
      try { peerConnectionRef.current.close(); } catch {}
      peerConnectionRef.current = null;
    }
    if (localCallStreamRef.current) {
      localCallStreamRef.current.getTracks().forEach((track) => track.stop());
      localCallStreamRef.current = null;
    }
    remoteCallStreamRef.current = null;
    pendingCallSignalsRef.current = [];
    startedOfferForCallRef.current = null;
    activeCallIdRef.current = null;
    callRecoveryAttemptRef.current = 0;
    detachCallMediaElements();
    resetCallMediaState();
  }, [detachCallMediaElements, resetCallMediaState]);

  const attachRemoteCallStream = useCallback((stream) => {
    if (!stream) return;
    remoteCallStreamRef.current = stream;
    if (remoteCallVideoRef.current) {
      remoteCallVideoRef.current.srcObject = stream;
      remoteCallVideoRef.current.play().catch(() => null);
    }
    if (remoteCallAudioRef.current) {
      remoteCallAudioRef.current.srcObject = stream;
      remoteCallAudioRef.current.play().catch(() => null);
    }
  }, []);

  const ensureCallConfig = useCallback(async () => {
    if (callConfig) return callConfig;
    const response = await fetch('/api/chat/call-config', { cache: 'no-store' });
    const payload = await readJsonSafe(response);
    if (!response.ok || !payload?.enabled) throw new Error(payload?.error || 'Звонки сейчас недоступны.');
    setCallConfig(payload);
    return payload;
  }, [callConfig, readJsonSafe]);

  const ensureLocalCallStream = useCallback(async (callType = 'audio') => {
    const wantsVideo = callType === 'video';
    if (localCallStreamRef.current) {
      const hasVideo = localCallStreamRef.current.getVideoTracks().length > 0;
      if (hasVideo === wantsVideo) {
        if (localCallVideoRef.current && wantsVideo) {
          localCallVideoRef.current.srcObject = localCallStreamRef.current;
          localCallVideoRef.current.muted = true;
          localCallVideoRef.current.play().catch(() => null);
        }
        setLocalCallReady(true);
        callMediaModeRef.current = wantsVideo ? 'video' : 'audio';
        return localCallStreamRef.current;
      }
      localCallStreamRef.current.getTracks().forEach((track) => track.stop());
      localCallStreamRef.current = null;
    }
    const stream = await requestMediaInput({ audio: true, video: wantsVideo });
    localCallStreamRef.current = stream;
    callMediaModeRef.current = wantsVideo ? 'video' : 'audio';
    if (localCallVideoRef.current && wantsVideo) {
      localCallVideoRef.current.srcObject = stream;
      localCallVideoRef.current.muted = true;
      localCallVideoRef.current.play().catch(() => null);
    } else if (localCallVideoRef.current) {
      localCallVideoRef.current.srcObject = null;
    }
    setLocalCallReady(true);
    return stream;
  }, [requestMediaInput]);

  const sendCallSignal = useCallback(async (callId, signalType, payload = {}) => {
    if (!callId) return;
    await fetch(`/api/chat/calls/${callId}/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signal_type: signalType, payload }),
    }).catch(() => null);
  }, []);

  const scheduleCallRecovery = useCallback((reason = 'Восстанавливаем звонок…', options = {}) => {
    const callId = activeCallIdRef.current || activeCall?.id;
    if (!callId || typeof window === 'undefined') return;
    if (callRecoveryTimeoutRef.current) {
      window.clearTimeout(callRecoveryTimeoutRef.current);
      callRecoveryTimeoutRef.current = null;
    }
    callRecoveryAttemptRef.current += 1;
    setCallClientError('');
    if (reason) setCallClientStatus(reason);
    const delay = Math.min(Math.max(Number(options.delay) || 1200, 250), 5000);
    callRecoveryTimeoutRef.current = window.setTimeout(() => {
      const targetCallId = activeCallIdRef.current || callId;
      refreshActiveCallStateRef.current?.(targetCallId, { force: true, reconnectMedia: true, silent: Boolean(options.silent) })
        .then((nextCall) => {
          if (nextCall) {
            emitMessengerTelemetry?.({
              category: 'call',
              metric: 'recovery',
              outcome: 'success',
              callSessionId: nextCall.id,
              conversationId: nextCall.conversation_id,
              details: { attempts: callRecoveryAttemptRef.current },
            });
            setCallClientError('');
            setCallClientStatus(callRecoveryAttemptRef.current > 1 ? 'Соединение восстановлено.' : 'Состояние звонка синхронизировано.');
          }
        })
        .catch((error) => {
          emitMessengerTelemetry?.({
            category: 'call',
            metric: 'recovery',
            outcome: 'error',
            callSessionId: callId,
            details: { reason: reason || '', error: error?.message || 'unknown_error' },
          });
          return null;
        });
    }, delay);
  }, [activeCall?.id, emitMessengerTelemetry]);

  const createPeerConnection = useCallback(async (call) => {
    const config = await ensureCallConfig();
    const pc = new RTCPeerConnection({ iceServers: Array.isArray(config?.ice_servers) ? config.ice_servers : [] });
    const remoteStream = new MediaStream();
    attachRemoteCallStream(remoteStream);
    pc.ontrack = (event) => {
      event.streams?.[0]?.getTracks?.().forEach((track) => remoteStream.addTrack(track));
      if (!event.streams?.[0]) remoteStream.addTrack(event.track);
      setRemoteCallReady(remoteStream.getTracks().length > 0);
      setCallClientStatus('Соединение установлено.');
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendCallSignal(call.id, 'ice', { candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate });
      }
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        if (callRecoveryTimeoutRef.current) {
          window.clearTimeout(callRecoveryTimeoutRef.current);
          callRecoveryTimeoutRef.current = null;
        }
        callRecoveryAttemptRef.current = 0;
        setCallClientError('');
        setCallClientStatus('Соединение установлено.');
      } else if (state === 'connecting') {
        setCallClientStatus('Подключаем звонок…');
      } else if (state === 'disconnected') {
        scheduleCallRecovery('Сеть нестабильна. Проверяем состояние звонка…', { delay: 1200, silent: true });
      } else if (state === 'failed') {
        scheduleCallRecovery('Связь прервалась. Восстанавливаем звонок…', { delay: 350 });
      }
    };
    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      if (iceState === 'connected' || iceState === 'completed') {
        if (callRecoveryTimeoutRef.current) {
          window.clearTimeout(callRecoveryTimeoutRef.current);
          callRecoveryTimeoutRef.current = null;
        }
        callRecoveryAttemptRef.current = 0;
      } else if (iceState === 'disconnected') {
        scheduleCallRecovery('Проверяем ICE-соединение…', { delay: 1200, silent: true });
      } else if (iceState === 'failed') {
        scheduleCallRecovery('Не удалось удержать ICE-соединение. Восстанавливаем…', { delay: 350 });
      }
    };
    peerConnectionRef.current = pc;
    return pc;
  }, [attachRemoteCallStream, ensureCallConfig, scheduleCallRecovery, sendCallSignal]);

  const addLocalTracksToPeer = useCallback((pc, stream) => {
    const senderKinds = new Set(pc.getSenders().map((sender) => sender.track?.kind).filter(Boolean));
    stream.getTracks().forEach((track) => {
      if (!senderKinds.has(track.kind)) {
        pc.addTrack(track, stream);
      }
    });
  }, []);

  const processIncomingCallSignal = useCallback(async (signal, callOverride = null) => {
    const call = callOverride || activeCall;
    if (!call?.id || !signal || signal.callId !== call.id) return;
    const type = String(signal.signal_type || '').toLowerCase();
    if (!['offer', 'answer', 'ice'].includes(type)) return;
    if (type === 'offer' && call.viewer?.can_accept) {
      pendingCallSignalsRef.current.push(signal);
      setCallClientStatus('Получен входящий звонок. Нажми «Принять», чтобы подключиться.');
      return;
    }
    try {
      const pc = peerConnectionRef.current || await createPeerConnection(call);
      if (!localCallStreamRef.current) {
        const stream = await ensureLocalCallStream(call.type);
        addLocalTracksToPeer(pc, stream);
      }
      if (type === 'offer' && signal.payload?.description) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
        await flushPendingCallSignalsRef.current?.(call);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendCallSignal(call.id, 'answer', { description: pc.localDescription });
        setCallClientStatus('Ответ отправлен. Подключаем звонок…');
      } else if (type === 'answer' && signal.payload?.description) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
        await flushPendingCallSignalsRef.current?.(call);
        setCallClientStatus('Собеседник ответил. Подключаем звонок…');
      } else if (type === 'ice' && signal.payload?.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.payload.candidate));
        } catch {
          pendingCallSignalsRef.current.push(signal);
        }
      }
    } catch (error) {
      console.error('call signal process failed', error);
      setCallClientError(error?.message || 'Не удалось обработать сигнал звонка.');
    }
  }, [activeCall, addLocalTracksToPeer, createPeerConnection, ensureLocalCallStream, sendCallSignal]);

  const flushPendingCallSignals = useCallback(async (call) => {
    const pending = [...pendingCallSignalsRef.current];
    pendingCallSignalsRef.current = [];
    for (const signal of pending) {
      // eslint-disable-next-line no-await-in-loop
      await processIncomingCallSignalRef.current?.(signal, call);
    }
  }, []);

  const ensureCallConnection = useCallback(async (call, options = {}) => {
    if (!call?.id || typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') return;
    const viewer = call.viewer || {};
    const shouldPrepare = Boolean(viewer.is_initiator || viewer.state === 'joined' || viewer.can_accept || viewer.can_toggle || call.status === 'active');
    if (!shouldPrepare) return;
    if (activeCallIdRef.current && activeCallIdRef.current !== call.id) {
      stopCallMedia();
    }
    activeCallIdRef.current = call.id;
    try {
      const pc = peerConnectionRef.current || await createPeerConnection(call);
      const stream = await ensureLocalCallStream(call.type);
      addLocalTracksToPeer(pc, stream);
      if (options.offer && viewer.is_initiator && startedOfferForCallRef.current !== call.id) {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: call.type === 'video' });
        await pc.setLocalDescription(offer);
        startedOfferForCallRef.current = call.id;
        await sendCallSignal(call.id, 'offer', { description: pc.localDescription });
        setCallClientStatus('Предложение звонка отправлено.');
      }
      await flushPendingCallSignalsRef.current?.(call);
    } catch (error) {
      console.error('call connect failed', error);
      setCallClientError(error?.message || 'Не удалось подготовить звонок.');
    }
  }, [addLocalTracksToPeer, createPeerConnection, ensureLocalCallStream, sendCallSignal, stopCallMedia]);

  const refreshActiveCallState = useCallback(async (callId = activeCallIdRef.current, options = {}) => {
    const targetCallId = callId || activeCallIdRef.current;
    if (!targetCallId || usingFallback) return null;
    const now = Date.now();
    if (callRefreshInFlightRef.current && !options.force) return null;
    if (!options.force && now - lastCallRefreshAtRef.current < 700) return null;
    callRefreshInFlightRef.current = true;
    lastCallRefreshAtRef.current = now;
    try {
      const response = await fetch(`/api/chat/calls/${targetCallId}`, { cache: 'no-store' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.call) throw new Error(payload?.error || 'Не удалось синхронизировать звонок.');
      const nextCall = normalizeActiveCall(payload.call);
      setActiveCall(nextCall);
      if (!nextCall) {
        stopCallMedia();
        setCallClientError('');
        setCallClientStatus('Звонок завершён.');
        return null;
      }
      if (options.reconnectMedia) {
        stopCallMedia();
        await ensureCallConnectionRef.current?.(nextCall, { offer: nextCall.viewer?.is_initiator && nextCall.status === 'ringing' });
      }
      return nextCall;
    } catch (error) {
      if (!options.silent) {
        setCallClientError(error?.message || 'Не удалось обновить состояние звонка.');
      }
      return null;
    } finally {
      callRefreshInFlightRef.current = false;
    }
  }, [normalizeActiveCall, readJsonSafe, stopCallMedia, usingFallback]);

  const callViewer = activeCall?.viewer || null;
  const hasLiveCall = Boolean(activeCall && ['ringing', 'active'].includes(activeCall.status));

  const syncLocalMediaFlags = useCallback(() => {
    const audioTrack = localCallStreamRef.current?.getAudioTracks?.()[0] || null;
    const videoTrack = localCallStreamRef.current?.getVideoTracks?.()[0] || null;
    if (audioTrack && typeof callViewer?.is_mic_on === 'boolean') {
      audioTrack.enabled = callViewer.is_mic_on;
    }
    if (videoTrack && typeof callViewer?.is_camera_on === 'boolean') {
      videoTrack.enabled = callViewer.is_camera_on;
    }
  }, [callViewer?.is_camera_on, callViewer?.is_mic_on]);

  useEffect(() => {
    refreshActiveCallStateRef.current = refreshActiveCallState;
    ensureCallConnectionRef.current = ensureCallConnection;
    processIncomingCallSignalRef.current = processIncomingCallSignal;
    flushPendingCallSignalsRef.current = flushPendingCallSignals;
  }, [ensureCallConnection, flushPendingCallSignals, processIncomingCallSignal, refreshActiveCallState]);

  useEffect(() => {
    syncLocalMediaFlags();
  }, [syncLocalMediaFlags]);

  useEffect(() => {
    if (!hasLiveCall || !activeCall) {
      stopCallMedia();
      return undefined;
    }
    const shouldOffer = activeCall.viewer?.is_initiator && activeCall.status === 'ringing';
    ensureCallConnection(activeCall, { offer: shouldOffer });
    return undefined;
  }, [activeCall?.id, activeCall?.status, activeCall?.viewer?.is_initiator, activeCall?.viewer?.state, activeCall?.viewer?.can_accept, activeCall?.viewer?.can_toggle, ensureCallConnection, hasLiveCall, stopCallMedia, activeCall]);

  useEffect(() => () => stopCallMedia(), [stopCallMedia]);

  useEffect(() => {
    if (!hasLiveCall || usingFallback || typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const handleOnline = () => {
      scheduleCallRecovery('Сеть вернулась. Синхронизируем звонок…', { delay: 400, silent: true });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        scheduleCallRecovery('Возвращаем состояние звонка…', { delay: 250, silent: true });
      }
    };
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [activeCall?.id, hasLiveCall, scheduleCallRecovery, usingFallback]);

  const callBannerTitle = useMemo(() => {
    if (!activeCall) return '';
    if (activeCall.status === 'active') {
      return activeCall.type === 'video' ? 'Идёт видеозвонок' : 'Идёт аудиозвонок';
    }
    return callViewer?.is_initiator
      ? (activeCall.type === 'video' ? 'Вызываешь видеозвонок' : 'Вызываешь собеседника')
      : (activeCall.type === 'video' ? 'Входящий видеозвонок' : 'Входящий аудиозвонок');
  }, [activeCall, callViewer?.is_initiator]);

  const callBannerText = useMemo(() => {
    if (!activeCall) return '';
    if (activeCall.status === 'active') {
      return activeCall.peer_names?.length ? activeCall.peer_names.join(', ') : 'Соединение установлено';
    }
    return callViewer?.is_initiator ? 'Ждём ответ собеседника.' : 'Можно принять звонок или отклонить его.';
  }, [activeCall, callViewer?.is_initiator]);

  return {
    activeCall,
    setActiveCall,
    callConfig,
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
    stopCallMedia,
    ensureCallConfig,
    ensureLocalCallStream,
    sendCallSignal,
    refreshActiveCallState,
    scheduleCallRecovery,
    processIncomingCallSignal,
    ensureCallConnection,
    callBannerTitle,
    callBannerText,
  };
}

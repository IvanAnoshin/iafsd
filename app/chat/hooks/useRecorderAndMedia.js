'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

const initialVoiceRecorderState = {
  phase: 'idle',
  stream: null,
  recorder: null,
  chunks: [],
  blob: null,
  url: null,
  mimeType: null,
  waveform: null,
  startedAt: null,
  elapsedMs: 0,
  permission: 'unknown',
  hasMicrophone: null,
  errorCode: null,
  errorMessage: null,
  requestId: 0,
};

function voiceRecorderReducer(state, action) {
  switch (action.type) {
    case 'OPEN':
      return { ...initialVoiceRecorderState, phase: 'checking', requestId: action.requestId };
    case 'CHECK_OK':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        hasMicrophone: action.hasMicrophone,
        permission: action.permission,
        phase: 'preparing',
        errorCode: null,
        errorMessage: null,
      };
    case 'PERMISSION':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        phase: 'permission',
        hasMicrophone: true,
        permission: action.permission,
        errorCode: 'permission_required',
        errorMessage: action.message,
      };
    case 'PREPARE_OK':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        phase: 'recording',
        stream: action.stream,
        recorder: action.recorder,
        mimeType: action.mimeType,
        startedAt: action.startedAt,
        elapsedMs: 0,
        chunks: [],
        blob: null,
        url: null,
        waveform: null,
        errorCode: null,
        errorMessage: null,
      };
    case 'TICK':
      if (state.phase !== 'recording') return state;
      return { ...state, elapsedMs: action.elapsedMs };
    case 'STOP_REQUESTED':
      if (state.phase !== 'recording') return state;
      return { ...state, phase: 'finalizing' };
    case 'FINALIZE_OK':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        phase: 'preview',
        stream: null,
        recorder: null,
        blob: action.blob,
        url: action.url,
        mimeType: action.mimeType,
        waveform: Array.isArray(action.waveform) ? action.waveform : null,
      };
    case 'SEND_START':
      if (state.phase !== 'preview' || !state.blob) return state;
      return { ...state, phase: 'sending' };
    case 'ERROR':
      if (action.requestId && action.requestId !== state.requestId) return state;
      return {
        ...state,
        phase: 'error',
        stream: null,
        recorder: null,
        errorCode: action.code,
        errorMessage: action.message,
      };
    case 'CLOSE':
      return { ...initialVoiceRecorderState, requestId: state.requestId };
    default:
      return state;
  }
}

async function inspectVoiceDevices() {
  if (!navigator?.mediaDevices?.enumerateDevices) {
    return { hasMicrophone: true, permission: 'unknown' };
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const hasMicrophone = devices.some((device) => device.kind === 'audioinput');
  let permission = 'unknown';
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });
    permission = result?.state || 'unknown';
  } catch {
    permission = 'unknown';
  }
  return { hasMicrophone, permission };
}

async function buildWaveformFromAudioBlob(blob, bars = 44) {
  if (!blob || !blob.size) return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  const audioContext = new AudioCtx();
  try {
    const buffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
    const channelData = audioBuffer.getChannelData(0);
    const blockSize = Math.max(1, Math.floor(channelData.length / bars));
    const peaks = [];
    for (let index = 0; index < bars; index += 1) {
      const start = index * blockSize;
      const end = Math.min(channelData.length, start + blockSize);
      let peak = 0;
      for (let offset = start; offset < end; offset += 1) {
        const value = Math.abs(channelData[offset] || 0);
        if (value > peak) peak = value;
      }
      peaks.push(peak);
    }
    const maxPeak = Math.max(...peaks, 0.01);
    const normalized = peaks
      .map((peak) => Number((Math.max(0.08, Math.min(1, peak / maxPeak))).toFixed(4)))
      .slice(0, 256);
    return normalized.length ? normalized : null;
  } catch {
    return null;
  } finally {
    if (typeof audioContext.close === 'function') {
      try { await audioContext.close(); } catch {}
    }
  }
}

function normalizeVoiceRecorderError(error) {
  const name = String(error?.name || '');
  const message = String(error?.message || '');
  if (name === 'NotAllowedError' || /permission denied|notallowed|denied/i.test(message)) {
    return { code: 'permission_denied', message: 'Разрешите доступ к микрофону, чтобы записать голосовое.' };
  }
  if (name === 'NotFoundError' || /device not found|not found/i.test(message)) {
    return { code: 'microphone_not_found', message: 'Микрофон не найден. Проверьте подключение устройства.' };
  }
  if (name === 'NotReadableError' || /could not start|track start|device in use|busy/i.test(message)) {
    return { code: 'microphone_busy', message: 'Микрофон занят другим приложением.' };
  }
  return { code: 'voice_unknown', message: error?.message || 'Не удалось записать голосовое сообщение.' };
}

const initialVideoNoteState = {
  phase: 'idle',
  stream: null,
  recorder: null,
  blob: null,
  url: null,
  mimeType: null,
  waveform: null,
  startedAt: null,
  elapsedMs: 0,
  permissionCamera: 'unknown',
  permissionMicrophone: 'unknown',
  hasCamera: null,
  hasMicrophone: null,
  errorCode: null,
  errorMessage: null,
  requestId: 0,
};

function videoNoteReducer(state, action) {
  switch (action.type) {
    case 'OPEN':
      return { ...initialVideoNoteState, phase: 'checking', requestId: action.requestId };
    case 'CHECK_OK':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        hasCamera: action.hasCamera,
        hasMicrophone: action.hasMicrophone,
        permissionCamera: action.permissionCamera,
        permissionMicrophone: action.permissionMicrophone,
        phase: 'preparing',
        errorCode: null,
        errorMessage: null,
      };
    case 'PERMISSION':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        phase: 'permission',
        hasCamera: true,
        hasMicrophone: true,
        permissionCamera: action.permissionCamera || state.permissionCamera,
        permissionMicrophone: action.permissionMicrophone || state.permissionMicrophone,
        errorCode: 'permission_required',
        errorMessage: action.message,
      };
    case 'PREPARE_OK':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        phase: 'preview_live',
        stream: action.stream,
        recorder: null,
        mimeType: action.mimeType,
        startedAt: null,
        elapsedMs: 0,
        blob: null,
        url: null,
        errorCode: null,
        errorMessage: null,
      };
    case 'START_RECORDING':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        phase: 'recording',
        recorder: action.recorder,
        mimeType: action.mimeType,
        startedAt: action.startedAt,
        elapsedMs: 0,
        errorCode: null,
        errorMessage: null,
      };
    case 'TICK':
      if (state.phase !== 'recording') return state;
      return { ...state, elapsedMs: action.elapsedMs };
    case 'STOP_REQUESTED':
      if (state.phase !== 'recording') return state;
      return { ...state, phase: 'finalizing' };
    case 'FINALIZE_OK':
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        phase: 'preview_result',
        stream: null,
        recorder: null,
        blob: action.blob,
        url: action.url,
        mimeType: action.mimeType,
        waveform: Array.isArray(action.waveform) ? action.waveform : null,
      };
    case 'SEND_START':
      if (state.phase !== 'preview_result' || !state.blob) return state;
      return { ...state, phase: 'sending' };
    case 'ERROR':
      if (action.requestId && action.requestId !== state.requestId) return state;
      return {
        ...state,
        phase: 'error',
        stream: null,
        recorder: null,
        errorCode: action.code,
        errorMessage: action.message,
      };
    case 'CLOSE':
      return { ...initialVideoNoteState, requestId: state.requestId };
    default:
      return state;
  }
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

function normalizeVideoNoteError(error) {
  const name = String(error?.name || '');
  const message = String(error?.message || '');
  if (name === 'NotAllowedError' || /permission denied|notallowed|denied/i.test(message)) {
    return { code: 'permission_denied', message: 'Разрешите доступ к камере и микрофону, чтобы записать видеокружок.' };
  }
  if (name === 'NotFoundError' || /device not found|not found/i.test(message)) {
    return { code: 'device_not_found', message: 'Камера не найдена или недоступна. Видеокружок сейчас недоступен.' };
  }
  if (name === 'NotReadableError' || /could not start|track start|device in use|busy/i.test(message)) {
    return { code: 'device_busy', message: 'Камера или микрофон заняты другим приложением.' };
  }
  return { code: 'video_note_unknown', message: error?.message || 'Не удалось записать видеокружок.' };
}

async function collectMediaProbeDiagnostics() {
  if (!navigator?.mediaDevices?.enumerateDevices) {
    return {
      audioInputCount: 0,
      videoInputCount: 0,
      microphonePermission: 'unsupported',
      cameraPermission: 'unsupported',
    };
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputCount = devices.filter((device) => device.kind === 'audioinput').length;
  const videoInputCount = devices.filter((device) => device.kind === 'videoinput').length;
  let microphonePermission = 'unknown';
  let cameraPermission = 'unknown';
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });
    microphonePermission = result?.state || 'unknown';
  } catch {
    microphonePermission = 'unknown';
  }
  try {
    const result = await navigator.permissions.query({ name: 'camera' });
    cameraPermission = result?.state || 'unknown';
  } catch {
    cameraPermission = 'unknown';
  }
  return { audioInputCount, videoInputCount, microphonePermission, cameraPermission };
}

function getVideoRequirementError(diagnostics, mode = 'video') {
  const hasCamera = Number(diagnostics?.videoInputCount || 0) > 0;
  const hasMic = Number(diagnostics?.audioInputCount || 0) > 0;
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

export function useRecorderAndMedia({
  activeChatId,
  usingFallback,
  composerMode,
  composeBlockedByRequest,
  setErrorText,
  requestMediaInput,
  readJsonSafe,
  buildChatUploadCacheKey,
  cloneMediaPayload,
  inferUploadKind,
  makeClientId,
  describeMediaPermissionError,
}) {
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const pendingAttachment = pendingAttachments[0] || null;
  const [uploadingAttachmentCount, setUploadingAttachmentCount] = useState(0);
  const uploadingAttachment = uploadingAttachmentCount > 0;
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);
  const fileInputRef = useRef(null);
  const attachmentIntentRef = useRef({ kind: 'file', accept: '', capture: '', multiple: true });
  const pendingAttachmentRef = useRef(null);
  const pendingAttachmentsRef = useRef([]);

  const [voiceRecorderState, dispatchVoiceRecorder] = useReducer(voiceRecorderReducer, initialVoiceRecorderState);
  const voiceRequestIdRef = useRef(0);
  const voiceTimerRef = useRef(null);
  const voiceLaunchInProgressRef = useRef(false);
  const previousVoiceRecorderChatIdRef = useRef(null);
  const closeVoiceRecorderRef = useRef(null);

  const [videoNoteState, dispatchVideoNote] = useReducer(videoNoteReducer, initialVideoNoteState);
  const videoNoteRequestIdRef = useRef(0);
  const videoNoteTimerRef = useRef(null);
  const videoNoteLiveRef = useRef(null);
  const videoLaunchInProgressRef = useRef(false);
  const previousVideoNoteChatIdRef = useRef(null);
  const closeVideoNoteRecorderRef = useRef(null);

  const [mediaProbeState, setMediaProbeState] = useState({
    open: false,
    loading: false,
    target: 'audio',
    diagnostics: null,
    success: false,
    errorName: '',
    errorMessage: '',
    trackSummary: '',
    attemptedAt: null,
  });
  const [videoCallFallback, setVideoCallFallback] = useState(null);

  const uploadQueueRef = useRef(Promise.resolve());
  const uploadInflightByKeyRef = useRef(new Map());
  const uploadedMediaCacheRef = useRef(new Map());

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
    pendingAttachmentRef.current = pendingAttachments[0] || null;
  }, [pendingAttachments]);

  const mediaDiagnostics = mediaProbeState.diagnostics;
  const audioInputCount = mediaDiagnostics?.audioInputCount ?? 0;
  const videoInputCount = mediaDiagnostics?.videoInputCount ?? 0;
  const hasDetectedMicrophone = audioInputCount > 0;
  const hasDetectedCamera = videoInputCount > 0;


  const setUploadingAttachment = useCallback((next) => {
    setUploadingAttachmentCount(next ? 1 : 0);
  }, []);

  const updatePendingAttachmentById = useCallback((localId, updater) => {
    if (!localId) return;
    setPendingAttachments((prev) => prev.map((item) => {
      if (item.local_id !== localId) return item;
      return typeof updater === 'function' ? updater(item) : { ...item, ...updater };
    }));
  }, []);

  const dropPendingAttachments = useCallback((ids = []) => {
    const targetIds = new Set((Array.isArray(ids) ? ids : [ids]).map((value) => String(value || '').trim()).filter(Boolean));
    if (!targetIds.size) {
      const removed = pendingAttachmentsRef.current;
      setPendingAttachments([]);
      return removed;
    }
    const removed = pendingAttachmentsRef.current.filter((item) => targetIds.has(String(item.local_id || '').trim()));
    setPendingAttachments((prev) => prev.filter((item) => !targetIds.has(String(item.local_id || '').trim())));
    return removed;
  }, []);

  const runMediaProbe = useCallback(async (target = 'audio') => {
    const wantsVideo = target === 'av';
    setMediaProbeState((prev) => ({
      ...prev,
      open: true,
      loading: true,
      target,
      success: false,
      errorName: '',
      errorMessage: '',
      trackSummary: '',
      attemptedAt: Date.now(),
    }));
    const diagnostics = await collectMediaProbeDiagnostics().catch(() => ({
      audioInputCount: 0,
      videoInputCount: 0,
      microphonePermission: 'unknown',
      cameraPermission: 'unknown',
    }));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantsVideo ? true : false });
      const audioTracks = stream.getAudioTracks().length;
      const videoTracks = stream.getVideoTracks().length;
      stream.getTracks().forEach((track) => track.stop());
      setMediaProbeState({
        open: true,
        loading: false,
        target,
        diagnostics,
        success: true,
        errorName: '',
        errorMessage: '',
        trackSummary: wantsVideo ? `Аудиодорожек: ${audioTracks}, видеодорожек: ${videoTracks}` : `Аудиодорожек: ${audioTracks}`,
        attemptedAt: Date.now(),
      });
    } catch (error) {
      console.error('media probe failed', error);
      setMediaProbeState({
        open: true,
        loading: false,
        target,
        diagnostics,
        success: false,
        errorName: String(error?.name || 'Error'),
        errorMessage: describeMediaPermissionError(error, { video: wantsVideo, mode: 'probe' }),
        trackSummary: '',
        attemptedAt: Date.now(),
      });
    }
  }, [describeMediaPermissionError]);

  const refreshMediaProbeDiagnostics = useCallback(async () => {
    const diagnostics = await collectMediaProbeDiagnostics().catch(() => ({
      audioInputCount: 0,
      videoInputCount: 0,
      microphonePermission: 'unknown',
      cameraPermission: 'unknown',
    }));
    setMediaProbeState((prev) => ({
      ...prev,
      open: true,
      diagnostics,
      attemptedAt: prev.attemptedAt || Date.now(),
    }));
  }, []);

  const closeMediaProbe = useCallback(() => {
    setMediaProbeState((prev) => ({ ...prev, open: false, loading: false }));
  }, []);

  const applyVideoDiagnostics = useCallback((diagnostics) => {
    if (!diagnostics) return;
    setMediaProbeState((prev) => ({
      ...prev,
      diagnostics: {
        audioInputCount: diagnostics.audioInputCount ?? (diagnostics.hasMicrophone ? 1 : 0),
        videoInputCount: diagnostics.videoInputCount ?? (diagnostics.hasCamera ? 1 : 0),
        microphonePermission: diagnostics.permissionMicrophone || 'unknown',
        cameraPermission: diagnostics.permissionCamera || 'unknown',
      },
    }));
  }, []);

  const rerunVideoAvailabilityCheck = useCallback(async () => {
    const diagnostics = await inspectVideoDevices().catch(() => null);
    if (diagnostics) {
      applyVideoDiagnostics(diagnostics);
      const availabilityMessage = getVideoRequirementError({
        audioInputCount: diagnostics.audioInputCount ?? (diagnostics.hasMicrophone ? 1 : 0),
        videoInputCount: diagnostics.videoInputCount ?? (diagnostics.hasCamera ? 1 : 0),
      }, 'call');
      if (availabilityMessage) {
        setVideoCallFallback({
          title: 'Камера не найдена',
          message: `${availabilityMessage} Можно начать аудиозвонок или повторить поиск камеры.`,
        });
      } else {
        setVideoCallFallback(null);
      }
    }
  }, [applyVideoDiagnostics]);

  useEffect(() => {
    refreshMediaProbeDiagnostics().catch(() => null);
  }, [refreshMediaProbeDiagnostics]);

  useEffect(() => {
    if (!navigator?.mediaDevices?.addEventListener) return undefined;
    const handleDeviceChange = () => {
      refreshMediaProbeDiagnostics().catch(() => null);
      rerunVideoAvailabilityCheck().catch(() => null);
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshMediaProbeDiagnostics, rerunVideoAvailabilityCheck]);

  useEffect(() => {
    setVideoCallFallback(null);
  }, [activeChatId]);

  useEffect(() => {
    if (hasDetectedCamera) setVideoCallFallback(null);
  }, [hasDetectedCamera]);

  const openAttachmentPicker = useCallback(() => {
    if (composerMode === 'edit' || uploadingAttachment || !activeChatId || usingFallback || composeBlockedByRequest) return;
    setAttachmentSheetOpen(true);
  }, [activeChatId, composeBlockedByRequest, composerMode, uploadingAttachment, usingFallback]);

  const launchAttachmentPicker = useCallback(({ kind = 'file', accept = '', capture = '', multiple = true } = {}) => {
    if (composerMode === 'edit' || uploadingAttachment || !activeChatId || usingFallback || composeBlockedByRequest) return;
    const input = fileInputRef.current;
    if (!input) return;
    attachmentIntentRef.current = { kind, accept, capture, multiple: multiple !== false && !capture };
    input.value = '';
    input.accept = accept || '';
    input.multiple = multiple !== false && !capture;
    if (capture) input.setAttribute('capture', capture);
    else input.removeAttribute('capture');
    setAttachmentSheetOpen(false);
    window.setTimeout(() => input.click(), 0);
  }, [activeChatId, composeBlockedByRequest, composerMode, uploadingAttachment, usingFallback]);

  const cleanupVoiceRecorderResources = useCallback((options = {}) => {
    const { revokeUrl = true, preserveBlob = false } = options;
    voiceRequestIdRef.current += 1;
    voiceLaunchInProgressRef.current = false;
    if (voiceTimerRef.current) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    try {
      if (voiceRecorderState.recorder && voiceRecorderState.recorder.state !== 'inactive') {
        voiceRecorderState.recorder.stop();
      }
    } catch {}
    voiceRecorderState.stream?.getTracks?.().forEach((track) => track.stop());
    if (revokeUrl && voiceRecorderState.url) {
      URL.revokeObjectURL(voiceRecorderState.url);
    }
    dispatchVoiceRecorder({ type: 'CLOSE' });
    if (preserveBlob && voiceRecorderState.blob && voiceRecorderState.url) {
      dispatchVoiceRecorder({
        type: 'FINALIZE_OK',
        requestId: voiceRecorderState.requestId,
        blob: voiceRecorderState.blob,
        url: voiceRecorderState.url,
        mimeType: voiceRecorderState.mimeType,
        waveform: voiceRecorderState.waveform,
      });
    }
  }, [voiceRecorderState.blob, voiceRecorderState.mimeType, voiceRecorderState.recorder, voiceRecorderState.requestId, voiceRecorderState.stream, voiceRecorderState.url, voiceRecorderState.waveform]);

  const beginVoiceRecording = useCallback(async (requestId) => {
    try {
      dispatchVoiceRecorder({ type: 'CHECK_OK', requestId, hasMicrophone: true, permission: 'unknown' });
      const stream = await requestMediaInput({ audio: true });
      if (requestId !== voiceRequestIdRef.current) {
        voiceLaunchInProgressRef.current = false;
        stream.getTracks?.().forEach((track) => track.stop());
        return;
      }
      const mimeCandidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
      const mimeType = mimeCandidates.find((value) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(value)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const startedAt = Date.now();
      const chunks = [];
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener('stop', async () => {
        if (requestId !== voiceRequestIdRef.current) return;
        const blob = chunks.length ? new Blob(chunks, { type: mimeType || chunks[0]?.type || 'audio/webm' }) : null;
        if (!blob || !blob.size) {
          dispatchVoiceRecorder({ type: 'ERROR', requestId, code: 'empty_recording', message: 'Запись получилась пустой.' });
          return;
        }
        const waveform = await buildWaveformFromAudioBlob(blob, 44);
        if (requestId !== voiceRequestIdRef.current) return;
        const url = URL.createObjectURL(blob);
        dispatchVoiceRecorder({
          type: 'FINALIZE_OK',
          requestId,
          blob,
          url,
          mimeType: blob.type || recorder.mimeType || null,
          waveform,
        });
      });
      recorder.addEventListener('error', (event) => {
        const normalized = normalizeVoiceRecorderError(event?.error || event);
        dispatchVoiceRecorder({ type: 'ERROR', requestId, code: normalized.code, message: normalized.message });
      });
      recorder.start();
      dispatchVoiceRecorder({ type: 'PREPARE_OK', requestId, stream, recorder, mimeType: mimeType || null, startedAt });
      voiceLaunchInProgressRef.current = false;
      voiceTimerRef.current = window.setInterval(() => {
        dispatchVoiceRecorder({ type: 'TICK', elapsedMs: Date.now() - startedAt });
      }, 250);
    } catch (error) {
      voiceLaunchInProgressRef.current = false;
      console.error('voice recorder failed', error);
      const normalized = normalizeVoiceRecorderError(error);
      if (normalized.code === 'microphone_not_found' || normalized.code === 'permission_denied') {
        try {
          const devices = await inspectVoiceDevices();
          if (devices.permission === 'denied') {
            dispatchVoiceRecorder({ type: 'PERMISSION', requestId, permission: devices.permission, message: 'Разрешите доступ к микрофону, чтобы записать голосовое.' });
            return;
          }
          if (!devices.hasMicrophone) {
            dispatchVoiceRecorder({ type: 'ERROR', requestId, code: 'microphone_not_found', message: 'Микрофон не найден. Проверьте подключение устройства.' });
            return;
          }
        } catch {}
      }
      dispatchVoiceRecorder({ type: 'ERROR', requestId, code: normalized.code, message: normalized.message });
    }
  }, [requestMediaInput]);

  const openVoiceRecorder = useCallback(async () => {
    if (composerMode === 'edit' || uploadingAttachment || !activeChatId || usingFallback) return;
    setAttachmentSheetOpen(false);
    setErrorText('');
    if (voiceRecorderState.url) {
      URL.revokeObjectURL(voiceRecorderState.url);
    }
    const requestId = voiceRequestIdRef.current + 1;
    voiceRequestIdRef.current = requestId;
    voiceLaunchInProgressRef.current = true;
    dispatchVoiceRecorder({ type: 'OPEN', requestId });
    try {
      await beginVoiceRecording(requestId);
    } catch (error) {
      const normalized = normalizeVoiceRecorderError(error);
      dispatchVoiceRecorder({ type: 'ERROR', requestId, code: normalized.code, message: normalized.message });
    }
  }, [activeChatId, beginVoiceRecording, composerMode, setErrorText, uploadingAttachment, usingFallback, voiceRecorderState.url]);

  const stopVoiceRecording = useCallback(() => {
    if (voiceRecorderState.phase !== 'recording' || !voiceRecorderState.recorder) return;
    dispatchVoiceRecorder({ type: 'STOP_REQUESTED' });
    try {
      voiceRecorderState.recorder.stop();
    } catch (error) {
      const normalized = normalizeVoiceRecorderError(error);
      dispatchVoiceRecorder({ type: 'ERROR', requestId: voiceRecorderState.requestId, code: normalized.code, message: normalized.message });
    }
  }, [voiceRecorderState.phase, voiceRecorderState.recorder, voiceRecorderState.requestId]);

  const closeVoiceRecorder = useCallback(() => {
    cleanupVoiceRecorderResources();
  }, [cleanupVoiceRecorderResources]);

  const retakeVoiceRecording = useCallback(() => {
    cleanupVoiceRecorderResources();
    window.setTimeout(() => {
      openVoiceRecorder();
    }, 0);
  }, [cleanupVoiceRecorderResources, openVoiceRecorder]);

  useEffect(() => {
    if (voiceRecorderState.phase === 'idle') return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeVoiceRecorder();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeVoiceRecorder, voiceRecorderState.phase]);

  useEffect(() => {
    const previousChatId = previousVoiceRecorderChatIdRef.current;
    if (previousChatId && previousChatId !== activeChatId) {
      closeVoiceRecorder();
    }
    previousVoiceRecorderChatIdRef.current = activeChatId;
  }, [activeChatId, closeVoiceRecorder]);

  useEffect(() => {
    closeVoiceRecorderRef.current = closeVoiceRecorder;
  }, [closeVoiceRecorder]);

  useEffect(() => {
    return () => {
      closeVoiceRecorderRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!videoNoteLiveRef.current) return;
    if (videoNoteState.phase === 'preview_live' || videoNoteState.phase === 'recording' || videoNoteState.phase === 'finalizing') {
      videoNoteLiveRef.current.srcObject = videoNoteState.stream || null;
      if (videoNoteState.stream) {
        videoNoteLiveRef.current.muted = true;
        videoNoteLiveRef.current.play().catch(() => null);
      }
    } else {
      videoNoteLiveRef.current.srcObject = null;
    }
  }, [videoNoteState.phase, videoNoteState.stream]);

  const forgetUploadedMediaCacheByUrl = useCallback((url) => {
    const targetUrl = String(url || '').trim();
    if (!targetUrl) return;
    const cache = uploadedMediaCacheRef.current;
    for (const [key, value] of cache.entries()) {
      if (String(value?.media?.url || '').trim() === targetUrl) {
        cache.delete(key);
      }
    }
  }, []);

  const markUploadedMediaCommitted = useCallback((mediaOrUrl) => {
    const targetUrl = String(typeof mediaOrUrl === 'string' ? mediaOrUrl : mediaOrUrl?.url || mediaOrUrl?.mediaUrl || '').trim();
    if (!targetUrl) return;
    const cache = uploadedMediaCacheRef.current;
    for (const [key, value] of cache.entries()) {
      if (String(value?.media?.url || '').trim() === targetUrl) {
        cache.set(key, { ...value, committed: true });
      }
    }
  }, []);

  const releaseChatMediaUpload = useCallback(async (mediaOrUrl, options = {}) => {
    const silent = options?.silent !== false;
    const url = String(typeof mediaOrUrl === 'string' ? mediaOrUrl : mediaOrUrl?.url || mediaOrUrl?.mediaUrl || '').trim();
    if (!url) return false;
    const cacheValues = [...uploadedMediaCacheRef.current.values()];
    if (cacheValues.some((item) => item?.committed && String(item?.media?.url || '').trim() === url)) {
      return false;
    }
    forgetUploadedMediaCacheByUrl(url);
    try {
      const response = await fetch('/api/chat/media/cleanup', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [url] }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok) throw new Error(payload?.error || 'Не удалось очистить временный файл.');
      return true;
    } catch (error) {
      if (!silent) console.error('chat media cleanup failed', error);
      return false;
    }
  }, [forgetUploadedMediaCacheByUrl, readJsonSafe]);

  const queueChatMediaUpload = useCallback(async ({ file, kind = '', metadata = {}, conversationId = '' }) => {
    if (!file || usingFallback) throw new Error('Загрузка файлов сейчас недоступна.');
    const meta = metadata && typeof metadata === 'object' ? /** @type {any} */ (metadata) : {};
    const resolvedKind = kind || inferUploadKind(file);
    const uploadKey = buildChatUploadCacheKey(file, resolvedKind, meta);
    const cached = uploadedMediaCacheRef.current.get(uploadKey);
    if (cached?.media?.url) {
      return {
        media: cloneMediaPayload(cached.media),
        message_type: cached.message_type || resolvedKind || cached.media?.kind || 'file',
        upload: cached.upload ? { ...cached.upload } : { storage: 'local', original_name: cached.media?.originalName || file.name },
        cached: true,
      };
    }

    const existing = uploadInflightByKeyRef.current.get(uploadKey);
    if (existing) {
      const payload = await existing;
      return { ...payload, media: cloneMediaPayload(payload.media) };
    }

    const startUpload = async () => {
      const formData = new FormData();
      formData.append('file', file);
      if (conversationId) formData.append('conversationId', conversationId);
      formData.append('kind', resolvedKind);
      if (meta?.durationSec) formData.append('durationSec', String(meta.durationSec));
      if (meta?.duration) formData.append('duration', String(meta.duration));
      if (meta?.durationSeconds) formData.append('durationSeconds', String(meta.durationSeconds));
      if (meta?.width) formData.append('width', String(meta.width));
      if (meta?.height) formData.append('height', String(meta.height));
      if (meta?.waveform) formData.append('waveform', JSON.stringify(meta.waveform));

      const response = await fetch('/api/chat/media/upload', {
        method: 'POST',
        body: formData,
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.media) throw new Error(payload?.error || 'Не удалось загрузить вложение.');
      const normalized = {
        media: cloneMediaPayload(payload.media),
        message_type: payload.message_type || payload.media.kind || resolvedKind || 'file',
        upload: payload.upload ? { ...payload.upload } : null,
      };
      uploadedMediaCacheRef.current.set(uploadKey, {
        ...normalized,
        media: cloneMediaPayload(normalized.media),
        committed: false,
      });
      return normalized;
    };

    const queued = uploadQueueRef.current.catch(() => null).then(startUpload);
    uploadQueueRef.current = queued.catch(() => null);
    uploadInflightByKeyRef.current.set(uploadKey, queued);
    try {
      const payload = await queued;
      return { ...payload, media: cloneMediaPayload(payload.media) };
    } finally {
      if (uploadInflightByKeyRef.current.get(uploadKey) === queued) {
        uploadInflightByKeyRef.current.delete(uploadKey);
      }
    }
  }, [buildChatUploadCacheKey, cloneMediaPayload, inferUploadKind, readJsonSafe, usingFallback]);

  const cleanupVideoNoteResources = useCallback(() => {
    videoNoteRequestIdRef.current += 1;
    videoLaunchInProgressRef.current = false;
    if (videoNoteTimerRef.current) {
      window.clearInterval(videoNoteTimerRef.current);
      videoNoteTimerRef.current = null;
    }
    try {
      if (videoNoteState.recorder && videoNoteState.recorder.state !== 'inactive') {
        videoNoteState.recorder.stop();
      }
    } catch {}
    videoNoteState.stream?.getTracks?.().forEach((track) => track.stop());
    if (videoNoteState.url) {
      URL.revokeObjectURL(videoNoteState.url);
    }
    dispatchVideoNote({ type: 'CLOSE' });
  }, [videoNoteState.recorder, videoNoteState.stream, videoNoteState.url]);

  const prepareVideoNotePreview = useCallback(async (requestId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 720 }, height: { ideal: 720 } },
      });
      if (requestId !== videoNoteRequestIdRef.current) {
        videoLaunchInProgressRef.current = false;
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      dispatchVideoNote({ type: 'PREPARE_OK', requestId, stream, mimeType: 'video/webm' });
      videoLaunchInProgressRef.current = false;
    } catch (error) {
      videoLaunchInProgressRef.current = false;
      console.error('video note preview failed', error);
      const normalized = normalizeVideoNoteError(error);
      dispatchVideoNote({ type: 'ERROR', requestId, code: normalized.code, message: normalized.message });
    }
  }, []);

  const openVideoNoteRecorder = useCallback(async () => {
    if (composerMode === 'edit' || uploadingAttachment || !activeChatId || usingFallback) return;
    setAttachmentSheetOpen(false);
    setErrorText('');
    if (videoNoteState.url) {
      URL.revokeObjectURL(videoNoteState.url);
    }
    const requestId = videoNoteRequestIdRef.current + 1;
    videoNoteRequestIdRef.current = requestId;
    videoLaunchInProgressRef.current = true;
    dispatchVideoNote({ type: 'OPEN', requestId });

    const diagnostics = await inspectVideoDevices().catch(() => null);
    if (diagnostics) {
      dispatchVideoNote({
        type: 'CHECK_OK',
        requestId,
        hasCamera: diagnostics.hasCamera,
        hasMicrophone: diagnostics.hasMicrophone,
        permissionCamera: diagnostics.permissionCamera,
        permissionMicrophone: diagnostics.permissionMicrophone,
      });
      applyVideoDiagnostics(diagnostics);
      const availabilityMessage = getVideoRequirementError({
        audioInputCount: diagnostics.audioInputCount ?? (diagnostics.hasMicrophone ? 1 : 0),
        videoInputCount: diagnostics.videoInputCount ?? (diagnostics.hasCamera ? 1 : 0),
      }, 'recorder');
      if (availabilityMessage) {
        videoLaunchInProgressRef.current = false;
        dispatchVideoNote({ type: 'ERROR', requestId, code: diagnostics.hasCamera ? 'microphone_not_found' : 'camera_not_found', message: availabilityMessage });
        return;
      }
    } else {
      dispatchVideoNote({ type: 'CHECK_OK', requestId, hasCamera: true, hasMicrophone: true, permissionCamera: 'unknown', permissionMicrophone: 'unknown' });
    }

    try {
      await prepareVideoNotePreview(requestId);
    } catch (error) {
      const normalized = normalizeVideoNoteError(error);
      dispatchVideoNote({ type: 'ERROR', requestId, code: normalized.code, message: normalized.message });
    }
  }, [activeChatId, applyVideoDiagnostics, composerMode, prepareVideoNotePreview, setErrorText, uploadingAttachment, usingFallback, videoNoteState.url]);

  const startVideoNoteRecording = useCallback(() => {
    if (videoNoteState.phase !== 'preview_live' || !videoNoteState.stream) return;
    try {
      const stream = videoNoteState.stream;
      const mimeCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mimeType = mimeCandidates.find((value) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(value)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const startedAt = Date.now();
      const chunks = [];
      const requestId = videoNoteState.requestId;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener('error', (event) => {
        const normalized = normalizeVideoNoteError(event?.error || event);
        dispatchVideoNote({ type: 'ERROR', requestId, code: normalized.code, message: normalized.message });
      });
      recorder.addEventListener('stop', () => {
        if (requestId !== videoNoteRequestIdRef.current) return;
        const blob = chunks.length ? new Blob(chunks, { type: mimeType || chunks[0]?.type || 'video/webm' }) : null;
        if (!blob || !blob.size) {
          dispatchVideoNote({ type: 'ERROR', requestId, code: 'empty_recording', message: 'Видеокружок получился пустым.' });
          return;
        }
        const url = URL.createObjectURL(blob);
        dispatchVideoNote({ type: 'FINALIZE_OK', requestId, blob, url, mimeType: blob.type || recorder.mimeType || null });
      });
      recorder.start();
      dispatchVideoNote({ type: 'START_RECORDING', requestId, recorder, mimeType: mimeType || null, startedAt });
      videoNoteTimerRef.current = window.setInterval(() => {
        dispatchVideoNote({ type: 'TICK', elapsedMs: Date.now() - startedAt });
      }, 250);
    } catch (error) {
      console.error('video note recording failed', error);
      const normalized = normalizeVideoNoteError(error);
      dispatchVideoNote({ type: 'ERROR', requestId: videoNoteState.requestId, code: normalized.code, message: normalized.message });
    }
  }, [videoNoteState.phase, videoNoteState.requestId, videoNoteState.stream]);

  const stopVideoNoteRecording = useCallback(() => {
    if (videoNoteState.phase !== 'recording' || !videoNoteState.recorder) return;
    dispatchVideoNote({ type: 'STOP_REQUESTED' });
    try {
      videoNoteState.recorder.stop();
    } catch (error) {
      const normalized = normalizeVideoNoteError(error);
      dispatchVideoNote({ type: 'ERROR', requestId: videoNoteState.requestId, code: normalized.code, message: normalized.message });
    }
  }, [videoNoteState.phase, videoNoteState.recorder, videoNoteState.requestId]);

  const closeVideoNoteRecorder = useCallback(() => {
    cleanupVideoNoteResources();
  }, [cleanupVideoNoteResources]);

  const retakeVideoNote = useCallback(() => {
    cleanupVideoNoteResources();
    window.setTimeout(() => {
      openVideoNoteRecorder();
    }, 0);
  }, [cleanupVideoNoteResources, openVideoNoteRecorder]);

  useEffect(() => {
    if (videoNoteState.phase === 'idle') return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeVideoNoteRecorder();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeVideoNoteRecorder, videoNoteState.phase]);

  useEffect(() => {
    const previousChatId = previousVideoNoteChatIdRef.current;
    if (previousChatId && previousChatId !== activeChatId) {
      closeVideoNoteRecorder();
    }
    previousVideoNoteChatIdRef.current = activeChatId;
  }, [activeChatId, closeVideoNoteRecorder]);

  useEffect(() => {
    closeVideoNoteRecorderRef.current = closeVideoNoteRecorder;
  }, [closeVideoNoteRecorder]);

  useEffect(() => {
    return () => {
      closeVideoNoteRecorderRef.current?.();
    };
  }, []);

  const uploadAttachmentFile = useCallback(async (file, kindOverride = '') => {
    if (!file || !activeChatId || usingFallback) return false;
    const resolvedKind = kindOverride || attachmentIntentRef.current?.kind || inferUploadKind(file);
    const localId = makeClientId();
    const baseDraft = {
      local_id: localId,
      status: 'uploading',
      message_type: resolvedKind,
      media: null,
      original_name: file.name,
      file_size: Number(file.size || 0) || null,
      mime: file.type || '',
      source_file: file,
      retry_kind: resolvedKind,
      error: '',
    };
    setUploadingAttachmentCount((prev) => prev + 1);
    setErrorText('');
    setPendingAttachments((prev) => [...prev, baseDraft]);
    try {
      const payload = await queueChatMediaUpload({ file, kind: resolvedKind, conversationId: activeChatId });
      updatePendingAttachmentById(localId, {
        ...baseDraft,
        status: 'ready',
        message_type: payload.message_type || payload.media.kind || resolvedKind || 'file',
        media: payload.media,
        original_name: payload.upload?.original_name || file.name,
        error: '',
      });
      return true;
    } catch (error) {
      console.error('chat attachment upload failed', error);
      const messageText = error?.message || 'Не удалось загрузить вложение.';
      setErrorText(messageText);
      updatePendingAttachmentById(localId, { ...baseDraft, status: 'failed', error: messageText });
      return false;
    } finally {
      attachmentIntentRef.current = { kind: 'file', accept: '', capture: '', multiple: true };
      setUploadingAttachmentCount((prev) => Math.max(0, prev - 1));
    }
  }, [activeChatId, inferUploadKind, makeClientId, queueChatMediaUpload, setErrorText, updatePendingAttachmentById, usingFallback]);

  const clearPendingAttachment = useCallback(async (target = null) => {
    if (uploadingAttachment) return;
    const ids = target ? [typeof target === 'object' ? target.local_id : target] : pendingAttachmentsRef.current.map((item) => item.local_id);
    const removed = dropPendingAttachments(ids);
    removed.forEach((item) => {
      if (item?.media?.url) releaseChatMediaUpload(item.media, { silent: true }).catch(() => null);
    });
    attachmentIntentRef.current = { kind: 'file', accept: '', capture: '', multiple: true };
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [dropPendingAttachments, uploadingAttachment]);

  const markPendingAttachmentCommitted = useCallback((target) => {
    const localId = typeof target === 'object' ? target?.local_id : target;
    if (!localId) return;
    dropPendingAttachments([localId]);
  }, [dropPendingAttachments]);

  const retryPendingAttachment = useCallback(async (target = null) => {
    const attachment = typeof target === 'object'
      ? target
      : pendingAttachmentsRef.current.find((item) => item.local_id === target) || pendingAttachmentRef.current;
    if (!attachment?.source_file || uploadingAttachment) return;
    dropPendingAttachments([attachment.local_id]);
    await uploadAttachmentFile(attachment.source_file, attachment.retry_kind || attachment.message_type || inferUploadKind(attachment.source_file));
  }, [dropPendingAttachments, inferUploadKind, uploadAttachmentFile, uploadingAttachment]);

  const handleAttachmentChange = useCallback(async (event) => {
    const files = Array.from(event.target.files || []).filter(Boolean);
    if (!files.length || !activeChatId || usingFallback) return;
    await Promise.all(files.map((file) => uploadAttachmentFile(file)));
  }, [activeChatId, uploadAttachmentFile, usingFallback]);

  const resetAttachmentUiState = useCallback(() => {
    setPendingAttachments([]);
    setUploadingAttachmentCount(0);
    setAttachmentSheetOpen(false);
    attachmentIntentRef.current = { kind: 'file', accept: '', capture: '', multiple: true };
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const setPendingAttachment = useCallback((next) => {
    setPendingAttachments(next ? [next] : []);
  }, []);

  return {
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
    uploadAttachmentFile,
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
  };
}

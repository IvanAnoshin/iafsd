import { useEffect, useMemo, useRef, useState } from 'react';
import { useMessageInteractions } from '../hooks/useMessageInteractions';
import { getMessageCapabilities } from '../lib/messageCapabilities';
import { buildStoriesHref } from '@/lib/stories-foundation';
import ChatOverlaySheets from './ChatOverlaySheets';
import { AttachIcon, BackIcon, CameraIcon, canBatchSelectMessage, Checks, MAX_BATCH_MESSAGE_SELECTION, MESSAGE_SEARCH_FILTERS, mediaFileLabel, mediaPermissionLabel, mediaPreviewLabel, MicIcon, MoreIcon, PhoneIcon, SearchIcon, searchFilterLabel, SendIcon, formatVoiceDuration, attachmentMetaLabel, attachmentStatusLabel } from './chatViewPrimitives';



function PauseIcon() {
  return <svg viewBox="0 0 24 24"><path d="M9 5h3v14H9z" /><path d="M15 5h3v14h-3z" /></svg>;
}

function PlayIcon() {
  return <svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z" /></svg>;
}

function StopRecordIcon() {
  return <svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>;
}

function TrashIcon() {
  return <svg viewBox="0 0 24 24"><path d="M4 7h16" /><path d="M9 7V5h6v2" /><path d="M7 7l1 12h8l1-12" /></svg>;
}

function RefreshIcon() {
  return <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-13.66-5.66L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 13.66 5.66L20 16" /><path d="M20 20v-4h-4" /></svg>;
}

function FileDocIcon() {
  return <svg viewBox="0 0 24 24"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" /><path d="M14 2v5h5" /><path d="M9 13h6" /><path d="M9 17h4" /></svg>;
}

function ImageStackIcon() {
  return <svg viewBox="0 0 24 24"><rect x="3" y="5" width="14" height="14" rx="3" /><path d="m7 15 2.8-3.2a1.2 1.2 0 0 1 1.87.03L14 15l1.9-2.12a1.2 1.2 0 0 1 1.86.02L21 17" /><circle cx="10" cy="9.5" r="1.3" /><path d="M8 3h10a2 2 0 0 1 2 2v10" /></svg>;
}

function VideoFrameIcon() {
  return <svg viewBox="0 0 24 24"><rect x="3" y="5" width="14" height="14" rx="3" /><path d="m21 8-4 3v2l4 3V8Z" /><path d="m10 10 3 2-3 2Z" /></svg>;
}

function StoryRingIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="M19 5 16.5 7.5" /></svg>;
}

function assetKindLabel(kind) {
  if (kind === 'image') return 'Фото';
  if (kind === 'video') return 'Видео';
  if (kind === 'file') return 'Файл';
  return 'Медиа';
}

function formatAssetBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1024 * 1024) return `${Math.max(0.1, Math.round((value / (1024 * 1024)) * 10) / 10)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function buildAssetMeta({ bytes = 0, mime = '', durationSec = 0 }) {
  const bits = [];
  const normalizedMime = String(mime || '').split(';')[0].trim();
  if (normalizedMime) bits.push(normalizedMime);
  if (durationSec > 0) bits.push(formatVoiceDuration(durationSec * 1000));
  const sizeLabel = formatAssetBytes(bytes);
  if (sizeLabel) bits.push(sizeLabel);
  return bits.join(' • ');
}


function storyTypeLabel(type = 'shared_story') {
  return type === 'story_reply' ? 'Ответ на момент' : 'Момент';
}

function storyCardTitle(item) {
  const storyRef = item?.story_ref || {};
  return storyRef.title || storyRef.author_name || (item?.type === 'story_reply' ? 'Ответ на момент' : 'Момент');
}

function storyCardSubtitle(item) {
  const storyRef = item?.story_ref || {};
  if (item?.type === 'story_reply') {
    return storyRef.subtitle || storyRef.reply_text || storyRef.author_name || 'Открывает момент и связанную переписку';
  }
  return storyRef.subtitle || storyRef.author_name || 'Подготовка к просмотру и шерингу момента';
}

function AssetGlyph({ kind }) {
  if (kind === 'image') return <ImageStackIcon />;
  if (kind === 'video') return <VideoFrameIcon />;
  return <FileDocIcon />;
}

function buildFallbackPeaks(seedSource = '', count = 44) {
  const seed = Array.from(String(seedSource || 'voice')).reduce((acc, char, index) => acc + char.charCodeAt(0) * (index + 1), 0) || 17;
  return Array.from({ length: count }).map((_, index) => {
    const value = Math.abs(Math.sin((seed + index * 11) / 17) + Math.cos((seed + index * 7) / 13));
    return Math.max(0.18, Math.min(1, value / 2));
  });
}

async function buildAudioPeaksFromSrc(src, count = 44) {
  if (!src) throw new Error('empty-src');
  const response = await fetch(src);
  if (!response.ok) throw new Error(`audio-fetch-${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) throw new Error('audio-context-unsupported');
  const audioContext = new AudioCtx();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channelData = audioBuffer.getChannelData(0);
    const blockSize = Math.max(1, Math.floor(channelData.length / count));
    const peaks = [];
    for (let i = 0; i < count; i += 1) {
      const start = i * blockSize;
      const end = Math.min(channelData.length, start + blockSize);
      let peak = 0;
      for (let offset = start; offset < end; offset += 1) {
        const value = Math.abs(channelData[offset] || 0);
        if (value > peak) peak = value;
      }
      peaks.push(peak);
    }
    const maxPeak = Math.max(...peaks, 0.01);
    return peaks.map((peak) => Math.max(0.14, Math.min(1, peak / maxPeak)));
  } finally {
    if (typeof audioContext.close === 'function') {
      try { await audioContext.close(); } catch {}
    }
  }
}

function normalizeWaveformValues(input, count = 44) {
  if (!Array.isArray(input) || !input.length) return null;
  const values = input
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.max(0.08, Math.min(1, value)));
  if (!values.length) return null;
  if (values.length === count) return values;
  return Array.from({ length: count }).map((_, index) => {
    const ratio = count > 1 ? index / (count - 1) : 0;
    const sourceIndex = Math.min(values.length - 1, Math.round(ratio * (values.length - 1)));
    return values[sourceIndex];
  });
}


function isInteractiveMessageTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('button, a, input, textarea, select, video, audio, .chatW-voicePlayer, .chatW-videoNotePlayer, .chatW-file, .chatW-media, .chatW-mediaCluster, .chatW-mediaViewer, .chatW-bubbleToolsTrigger, .chatW-failedInline button'));
}

function buildMediaViewerEntry(item) {
  if (!item?.media?.url || !['image', 'video'].includes(String(item.type || '').toLowerCase())) return null;
  return {
    id: item.id || item.client_id,
    type: item.type,
    url: item.media.url,
    thumbUrl: item.media.thumb_url || item.media.thumbUrl || item.media.url,
    text: item.text || '',
    time: item.time || '',
    senderName: item.sender?.name || '',
    durationSec: Number(item.media?.durationSec || item.media?.duration || 0) || 0,
  };
}

function buildMediaViewerEntries(items = []) {
  return (Array.isArray(items) ? items : [items])
    .map((item) => buildMediaViewerEntry(item))
    .filter(Boolean);
}

function normalizeConversationRequestState(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (['incoming', 'outgoing', 'blocked', 'rejected'].includes(normalized)) return normalized;
  return '';
}

function getConversationRequestMeta(state) {
  switch (normalizeConversationRequestState(state)) {
    case 'incoming':
      return {
        tone: 'incoming',
        title: 'Запрос на переписку ждёт решения',
        text: 'Прими запрос, чтобы открыть двустороннюю переписку и отправлять новые сообщения.',
        composerTitle: 'Сначала примите запрос на переписку',
        composerText: 'После принятия запроса можно будет отвечать в этом диалоге без ограничений.',
        placeholder: 'Сначала примите запрос на переписку',
      };
    case 'outgoing':
      return {
        tone: 'outgoing',
        title: 'Запрос отправлен',
        text: 'Пока собеседник не примет запрос, новые сообщения и медиа будут недоступны.',
        composerTitle: 'Ожидаем принятия запроса',
        composerText: 'Как только собеседник примет запрос, здесь снова появится активный composer.',
        placeholder: 'Ждём, пока собеседник примет запрос',
      };
    case 'blocked':
      return {
        tone: 'blocked',
        title: 'Переписка заблокирована',
        text: 'Этот диалог сейчас недоступен для новых сообщений. Можно просматривать историю, но не писать.',
        composerTitle: 'Новые сообщения недоступны',
        composerText: 'Собеседник ограничил переписку или диалог заблокирован настройками доступа.',
        placeholder: 'Отправка сообщений недоступна',
      };
    case 'rejected':
      return {
        tone: 'rejected',
        title: 'Запрос отклонён',
        text: 'Новые сообщения недоступны, пока не появится новый разрешённый сценарий общения.',
        composerTitle: 'Этот запрос был отклонён',
        composerText: 'Сейчас composer отключён, потому что запрос на переписку не был принят.',
        placeholder: 'Запрос был отклонён',
      };
    default:
      return null;
  }
}

function classifyMediaHubItem(item) {
  const type = String(item?.type || '').trim().toLowerCase();
  if (type === 'image') return 'image';
  if (type === 'video' || type === 'video_note') return 'video';
  if (type === 'voice') return 'voice';
  if (type === 'file') return 'file';
  return '';
}

function VoiceMessagePlayer({ src, durationMs = 0, direction = 'incoming', variant = 'bubble', className = '', waveform = null, disabled = false }) {
  const audioRef = useRef(null);
  const waveformRef = useRef(null);
  const waveformBars = variant === 'preview' ? 36 : 42;
  const normalizedWaveform = useMemo(() => normalizeWaveformValues(waveform, waveformBars), [waveform, waveformBars]);
  const fallbackPeaks = useMemo(() => buildFallbackPeaks(src, waveformBars), [src, waveformBars]);
  const [peaks, setPeaks] = useState(normalizedWaveform || fallbackPeaks);
  const [loadingWave, setLoadingWave] = useState(Boolean(src) && !normalizedWaveform);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationMs > 0 ? durationMs / 1000 : 0);
  const [scrubRatio, setScrubRatio] = useState(null);
  const [scrubbing, setScrubbing] = useState(false);

  useEffect(() => {
    const cache = window.__chatVoiceWaveCache instanceof Map ? window.__chatVoiceWaveCache : new Map();
    window.__chatVoiceWaveCache = cache;
    if (normalizedWaveform?.length) {
      setPeaks(normalizedWaveform);
      setLoadingWave(false);
      if (src) cache.set(src, normalizedWaveform);
      return undefined;
    }
    const cached = src ? cache.get(src) : null;
    if (Array.isArray(cached) && cached.length) {
      setPeaks(cached);
      setLoadingWave(false);
      return undefined;
    }

    setPeaks(fallbackPeaks);
    setLoadingWave(Boolean(src));
    let cancelled = false;
    if (!src) return () => { cancelled = true; };

    buildAudioPeaksFromSrc(src, waveformBars)
      .then((nextPeaks) => {
        if (!cancelled && Array.isArray(nextPeaks) && nextPeaks.length) {
          cache.set(src, nextPeaks);
          setPeaks(nextPeaks);
        }
      })
      .catch(() => {
        if (!cancelled) setPeaks(fallbackPeaks);
      })
      .finally(() => {
        if (!cancelled) setLoadingWave(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fallbackPeaks, normalizedWaveform, src, waveformBars]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const syncTime = () => {
      if (!scrubbing) setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    };
    const syncDuration = () => {
      const nextDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (durationMs > 0 ? durationMs / 1000 : 0);
      setDuration(nextDuration);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
      setScrubRatio(null);
      setScrubbing(false);
    };

    syncDuration();
    syncTime();
    audio.addEventListener('loadedmetadata', syncDuration);
    audio.addEventListener('timeupdate', syncTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', syncDuration);
      audio.removeEventListener('timeupdate', syncTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      if (window.__chatActiveVoiceAudio === audio) window.__chatActiveVoiceAudio = null;
    };
  }, [src, durationMs, scrubbing]);

  useEffect(() => {
    setCurrentTime(0);
    setPlaying(false);
    setDuration(durationMs > 0 ? durationMs / 1000 : 0);
    setScrubbing(false);
    setScrubRatio(null);
  }, [src, durationMs]);

  const totalDuration = duration > 0 ? duration : (durationMs > 0 ? durationMs / 1000 : 0);
  const progress = totalDuration > 0 ? Math.min(1, currentTime / totalDuration) : 0;
  const visualRatio = scrubbing && scrubRatio !== null ? scrubRatio : progress;
  const clampedVisualRatio = Math.max(0, Math.min(1, visualRatio));
  const playheadRatio = Math.max(0.025, Math.min(0.975, clampedVisualRatio));
  const scrubBadgeRatio = Math.max(0.12, Math.min(0.88, scrubRatio !== null ? Math.max(0, Math.min(1, scrubRatio)) : clampedVisualRatio));
  const currentTimeLabel = formatVoiceDuration(Math.max(0, Math.round(currentTime * 1000)));
  const totalTimeLabel = formatVoiceDuration(Math.max(0, Math.round(totalDuration * 1000)));
  const previewLabel = playing ? 'Сейчас играет' : 'Готово';
  const scrubTimeLabel = formatVoiceDuration(Math.max(0, Math.round((scrubRatio || 0) * totalDuration * 1000)));

  const togglePlayback = async () => {
    if (disabled) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (window.__chatActiveVoiceAudio && window.__chatActiveVoiceAudio !== audio) {
      try { window.__chatActiveVoiceAudio.pause(); } catch {}
    }
    window.__chatActiveVoiceAudio = audio;
    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  };

  const ratioFromClientX = (clientX) => {
    const node = waveformRef.current;
    if (!node) return 0;
    const rect = node.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(rect.width, 1)));
  };

  const commitSeek = (ratio) => {
    const audio = audioRef.current;
    if (!audio || !totalDuration) return;
    const nextTime = totalDuration * ratio;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const beginScrub = (event) => {
    if (disabled || !totalDuration) return;
    const ratio = ratioFromClientX(event.clientX);
    setScrubbing(true);
    setScrubRatio(ratio);
    commitSeek(ratio);
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
  };

  const moveScrub = (event) => {
    if (!scrubbing || !totalDuration) return;
    const ratio = ratioFromClientX(event.clientX);
    setScrubRatio(ratio);
    commitSeek(ratio);
  };

  const endScrub = (event) => {
    if (disabled || !scrubbing || !totalDuration) return;
    const ratio = ratioFromClientX(event.clientX);
    setScrubRatio(ratio);
    commitSeek(ratio);
    setTimeout(() => {
      setScrubbing(false);
      setScrubRatio(null);
    }, 120);
  };

  return (
    <div
      className={`chatW-voicePlayer ${variant === 'preview' ? 'is-preview' : ''} ${direction === 'outgoing' ? 'is-outgoing' : 'is-incoming'} ${playing ? 'is-playing' : ''} ${scrubbing ? 'is-scrubbing' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()}
      style={{ '--voice-progress': `${clampedVisualRatio}` }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <audio ref={audioRef} className="chatW-voicePlayer-audio" src={src || undefined} preload="metadata" />
      <button type="button" className="chatW-voicePlayer-play" onClick={(event) => { event.stopPropagation(); togglePlayback(); }} aria-label={playing ? 'Пауза' : 'Воспроизвести голосовое'} disabled={disabled}>
        <span className="chatW-voicePlayer-playInner">{playing ? <PauseIcon /> : <PlayIcon />}</span>
      </button>
      <div className="chatW-voicePlayer-main">
        <button
          type="button"
          ref={waveformRef}
          className={`chatW-voicePlayer-wave ${loadingWave ? 'is-loading' : ''}`}
          onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); beginScrub(event); }}
          onPointerMove={(event) => { event.preventDefault(); event.stopPropagation(); moveScrub(event); }}
          onPointerUp={(event) => { event.preventDefault(); event.stopPropagation(); endScrub(event); }}
          onPointerCancel={(event) => { event.stopPropagation(); setScrubbing(false); setScrubRatio(null); }}
          aria-label="Перемотать голосовое"
          disabled={disabled}
        >
          <span className="chatW-voicePlayer-waveGlow" aria-hidden="true" />
          <span className="chatW-voicePlayer-progressFill" style={{ width: `${Math.max(3, clampedVisualRatio * 100)}%` }} />
          {peaks.map((peak, index) => {
            const ratio = peaks.length > 1 ? index / (peaks.length - 1) : 0;
            const active = ratio <= clampedVisualRatio;
            return <span key={`${src || 'voice'}-${index}`} className={active ? 'is-active' : ''} style={{ height: `${Math.round((variant === 'preview' ? 12 : 10) + peak * (variant === 'preview' ? 18 : 12))}px` }} />;
          })}
          <i className="chatW-voicePlayer-playhead" style={{ left: `${playheadRatio * 100}%` }} />
          {scrubbing ? <span className="chatW-voicePlayer-scrubBadge" style={{ left: `${scrubBadgeRatio * 100}%` }}>{scrubTimeLabel}</span> : null}
        </button>
        <div className="chatW-voicePlayer-meta">
          <div className="chatW-voicePlayer-times">
            <strong>{currentTimeLabel}</strong>
            <span className="chatW-voicePlayer-timeDivider">/</span>
            <span>{totalTimeLabel}</span>
          </div>
          {variant === 'preview' ? <span className="chatW-voicePlayer-label">{previewLabel}</span> : <span className="chatW-voicePlayer-statusDot" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}


function VideoNotePlayer({ src, direction = 'incoming', variant = 'bubble', className = '', disabled = false }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const syncTime = () => setCurrentTime(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    const syncDuration = () => setDuration(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onLoaded = () => {
      syncDuration();
      setReady(true);
    };
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
      try { video.currentTime = 0; } catch {}
    };

    syncTime();
    syncDuration();
    setReady(video.readyState >= 2);
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('timeupdate', syncTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);

    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('timeupdate', syncTime);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      if (window.__chatActiveVideoNoteVideo === video) window.__chatActiveVideoNoteVideo = null;
    };
  }, [src]);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setReady(false);
  }, [src]);

  const ratio = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const circleRadius = variant === 'preview' ? 68 : 58;
  const circumference = 2 * Math.PI * circleRadius;
  const dashOffset = circumference * (1 - ratio);
  const timeLabel = formatVoiceDuration(Math.round(currentTime * 1000));
  const totalLabel = formatVoiceDuration(Math.round(duration * 1000));

  const togglePlayback = async () => {
    if (disabled) return;
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (window.__chatActiveVideoNoteVideo && window.__chatActiveVideoNoteVideo !== video) {
      try { window.__chatActiveVideoNoteVideo.pause(); } catch {}
    }
    window.__chatActiveVideoNoteVideo = video;
    try {
      await video.play();
    } catch {
      setPlaying(false);
    }
  };

  return (
    <div className={`chatW-videoNotePlayer ${variant === 'preview' ? 'is-preview' : 'is-bubble'} ${direction === 'outgoing' ? 'is-outgoing' : 'is-incoming'} ${playing ? 'is-playing' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <div className="chatW-videoNoteShell">
        <video ref={videoRef} className="chatW-videoNoteVideo" src={src || undefined} preload="metadata" playsInline />
        <div className="chatW-videoNoteGlow" aria-hidden="true" />
        <svg className="chatW-videoNoteRing" viewBox="0 0 160 160" aria-hidden="true">
          <circle cx="80" cy="80" r={circleRadius} className="chatW-videoNoteRingTrack" />
          <circle cx="80" cy="80" r={circleRadius} className="chatW-videoNoteRingProgress" style={{ strokeDasharray: circumference, strokeDashoffset: dashOffset }} />
        </svg>
        <button type="button" className="chatW-videoNotePlay" onClick={(event) => { event.stopPropagation(); togglePlayback(); }} aria-label={playing ? 'Пауза' : 'Воспроизвести видеокружок'} disabled={disabled}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <div className="chatW-videoNoteMeta">
          <strong>{playing ? timeLabel : totalLabel || '0:00'}</strong>
          <span>{playing ? 'играет' : ready ? 'видеокружок' : 'готовим'}</span>
        </div>
      </div>
    </div>
  );
}

function LiveVoiceWave({ bars = 28 }) {
  return (
    <div className="chatW-liveVoiceWave" aria-hidden="true">
      {Array.from({ length: bars }).map((_, index) => <span key={index} style={{ height: `${16 + ((index * 9) % 22)}px` }} />)}
    </div>
  );
}


function MessageFileCard({ item, messageSelectionMode = false }) {
  const fileName = mediaFileLabel(item);
  const meta = buildAssetMeta({
    bytes: item?.media?.bytes,
    mime: item?.media?.mime,
    durationSec: Number(item?.media?.durationSec || item?.media?.duration || 0) || 0,
  });

  return (
    <a
      className={`chatW-file chatW-assetCard is-file ${item.direction === 'outgoing' ? 'is-outgoing' : ''} ${messageSelectionMode ? 'is-disabled' : ''}`.trim()}
      href={item.media?.url}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      aria-disabled={messageSelectionMode}
      tabIndex={messageSelectionMode ? -1 : 0}
    >
      <div className="chatW-assetThumb is-file" aria-hidden="true">
        <AssetGlyph kind="file" />
      </div>
      <div className="chatW-assetBody">
        <div className="chatW-assetRow">
          <strong className="chatW-assetTitle">{fileName}</strong>
          <span className="chatW-assetKind">Файл</span>
        </div>
        {meta ? <div className="chatW-assetMetaLine">{meta}</div> : null}
        <div className="chatW-assetSubline">Открыть вложение</div>
      </div>
      <span className="chatW-assetCta">Открыть</span>
    </a>
  );
}


function StoryReferenceCard({ item, messageSelectionMode = false }) {
  const storyRef = item?.story_ref || {};
  const href = storyRef.deep_link || buildStoriesHref({
    source: 'chat',
    mode: 'viewer',
    userId: storyRef.author_id || null,
    storyId: storyRef.story_id || null,
    itemId: storyRef.item_id || null,
    name: storyRef.author_name || storyCardTitle(item),
    title: storyCardTitle(item),
  });
  const Container = href && !messageSelectionMode ? 'a' : 'div';
  const props = href && !messageSelectionMode
    ? {
        href,
        target: href.startsWith('http') ? '_blank' : undefined,
        rel: href.startsWith('http') ? 'noreferrer' : undefined,
        onClick: (event) => event.stopPropagation(),
      }
    : {};

  return (
    <Container
      className={`chatW-storyRefCard ${item.direction === 'outgoing' ? 'is-outgoing' : 'is-incoming'} ${messageSelectionMode ? 'is-disabled' : ''}`.trim()}
      {...props}
    >
      <div className={`chatW-storyRefThumb ${storyRef.preview_url ? 'has-preview' : ''}`} aria-hidden="true">
        {storyRef.preview_url ? <img src={storyRef.preview_url} alt="preview" loading="lazy" draggable={false} /> : <ImageStackIcon />}
        <span className="chatW-storyRefPill">{storyTypeLabel(item.type)}</span>
      </div>
      <div className="chatW-storyRefBody">
        <div className="chatW-storyRefTitleRow">
          <strong className="chatW-storyRefTitle">{storyCardTitle(item)}</strong>
          {storyRef.expires_at ? <span className="chatW-storyRefMeta">24ч</span> : null}
        </div>
        <div className="chatW-storyRefSubtitle">{storyCardSubtitle(item)}</div>
        <div className="chatW-storyRefFooter">
          <span className="chatW-storyRefHint">{href && !messageSelectionMode ? 'Открыть ссылку' : 'Stories foundation'}</span>
          {storyRef.author_name ? <span className="chatW-storyRefAuthor">{storyRef.author_name}</span> : null}
        </div>
      </div>
    </Container>
  );
}

function ComposerAttachmentCard(props) {
  const { attachment, uploadingAttachment, retryPendingAttachment, clearPendingAttachment } = props;
  const previewUrl = attachment.media?.thumb_url || attachment.media?.thumbUrl || attachment.media?.url || '';
  const previewKind = String(attachment.message_type || '').toLowerCase();
  const status = String(attachment.status || '').toLowerCase();
  const title = mediaPreviewLabel(attachment.message_type, attachment.media);
  const subtitle = attachment.original_name || attachment.media?.originalName || attachment.media?.original_name || attachment.media?.url || 'Вложение';
  const meta = attachmentMetaLabel(attachment);

  return (
    <div className={`chatW-attachmentcard ${status === 'failed' ? 'is-error' : status === 'ready' ? 'is-ready' : ''}`}>
      <div className="chatW-attachmentcard-main">
        {previewUrl && ['image', 'video'].includes(previewKind) ? (
          <div className={`chatW-attachmentthumb ${previewKind === 'video' ? 'is-video' : 'is-image'}`} style={{ backgroundImage: `url(${previewUrl})` }} aria-hidden="true">
            <span className="chatW-attachmentthumb-kind">{assetKindLabel(previewKind)}</span>
            {previewKind === 'video' ? <span className="chatW-attachmentthumb-badge">▶</span> : null}
          </div>
        ) : (
          <div className="chatW-attachmentthumb is-generic" aria-hidden="true">
            <AssetGlyph kind={previewKind} />
          </div>
        )}
        <div className="chatW-attachmentmeta chatW-assetBody">
          <div className="chatW-assetRow">
            <strong className="chatW-assetTitle">{title}</strong>
            <span className="chatW-assetKind">{assetKindLabel(previewKind === 'video_note' ? 'video' : previewKind === 'voice' ? 'file' : previewKind)}</span>
          </div>
          <span className="chatW-attachmentname chatW-assetSubline">{subtitle}</span>
          {meta ? <span className="chatW-attachmentcaption chatW-assetMetaLine">{meta}</span> : null}
          <div className="chatW-assetPills">
            <span className={`chatW-attachmentstatus ${status === 'failed' ? 'is-error' : status === 'ready' ? 'is-ready' : ''}`}>{attachmentStatusLabel(attachment, uploadingAttachment)}</span>
          </div>
        </div>
      </div>
      <div className="chatW-attachmentactions">
        {status === 'failed' ? <button type="button" onClick={() => retryPendingAttachment(attachment)}>Повторить</button> : null}
        {status !== 'uploading' ? <button type="button" onClick={() => clearPendingAttachment(attachment)}>Убрать</button> : null}
      </div>
    </div>
  );
}

function MediaClusterItem(props) {
  const { cluster, messageSelectionMode, onOpenMedia } = props;
  const items = Array.isArray(cluster?.items) ? cluster.items.filter((item) => item?.media?.url) : [];
  if (!items.length) return null;
  const previewItems = items.slice(0, 4);
  const extraCount = Math.max(0, items.length - previewItems.length);
  const layoutClass = `is-count-${Math.min(previewItems.length, 4)}`;

  return (
    <div className={`chatW-row ${cluster.direction === 'outgoing' ? 'is-outgoing' : 'is-incoming'}`}>
      <div className={`chatW-bubble chatW-mediaClusterBubble ${cluster.direction === 'outgoing' ? 'is-outgoing' : 'is-incoming'}`}>
        <div className={`chatW-mediaCluster ${layoutClass}`}>
          {previewItems.map((mediaItem, index) => {
                        const isVideo = mediaItem.type === 'video';
            return (
              <button
                key={mediaItem.id || mediaItem.client_id || `${cluster.id}-${index}`}
                type="button"
                className={`chatW-mediaClusterTile ${isVideo ? 'is-video' : 'is-image'}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (messageSelectionMode) return;
                  onOpenMedia?.(items, index);
                }}
                disabled={messageSelectionMode}
              >
                {isVideo ? (
                  <video className="chatW-mediaClusterMedia" src={mediaItem.media.url} muted playsInline preload="metadata" />
                ) : (
                  <img className="chatW-mediaClusterMedia" src={mediaItem.media.url} alt={mediaItem.text || 'Изображение'} loading="lazy" draggable={false} />
                )}
                {isVideo ? <span className="chatW-mediaClusterBadge">▶</span> : null}
                {extraCount > 0 && index === previewItems.length - 1 ? <span className="chatW-mediaClusterMore">+{extraCount}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="chatW-bubble-meta">
          <span>{items[items.length - 1]?.time || cluster.items[cluster.items.length - 1]?.time || ''}</span>
          <span>{items.length} медиа</span>
          {cluster.direction === 'outgoing' ? <Checks state={items[items.length - 1]?.state || 'sent'} /> : null}
        </div>
      </div>
    </div>
  );
}

function MediaViewerOverlay({ viewerState, closeViewer, stepViewer, selectViewerIndex }) {
  const items = Array.isArray(viewerState?.items) ? viewerState.items : [];
  const activeIndex = Math.max(0, Math.min(items.length - 1, Number(viewerState?.index || 0) || 0));
  const activeItem = items[activeIndex] || null;
  if (!viewerState?.open || !activeItem) return null;

  return (
    <div className="chatW-mediaViewerBackdrop" onClick={closeViewer}>
      <div className="chatW-mediaViewer" role="dialog" aria-modal="true" aria-label="Просмотр медиа" onClick={(event) => event.stopPropagation()}>
        <div className="chatW-mediaViewerTopbar">
          <div className="chatW-mediaViewerMeta">
            <strong>{activeItem.senderName || 'Медиа'}</strong>
            <span>{activeItem.time || ''}</span>
          </div>
          <button type="button" className="chatW-mediaViewerClose" onClick={closeViewer} aria-label="Закрыть просмотр медиа">×</button>
        </div>
        <div className="chatW-mediaViewerStage">
          {items.length > 1 ? <button type="button" className="chatW-mediaViewerNav is-prev" onClick={() => stepViewer(-1)} aria-label="Предыдущее медиа">‹</button> : null}
          <div className="chatW-mediaViewerFrame">
            {activeItem.type === 'video' ? (
              <video className="chatW-mediaViewerMedia" src={activeItem.url} controls autoPlay playsInline preload="metadata" />
            ) : (
              <img className="chatW-mediaViewerMedia" src={activeItem.url} alt={activeItem.text || 'Изображение'} draggable={false} />
            )}
          </div>
          {items.length > 1 ? <button type="button" className="chatW-mediaViewerNav is-next" onClick={() => stepViewer(1)} aria-label="Следующее медиа">›</button> : null}
        </div>
        <div className="chatW-mediaViewerFooter">
          <div className="chatW-mediaViewerCaption">{activeItem.text || (activeItem.type === 'video' ? 'Видео' : 'Изображение')}</div>
          {items.length > 1 ? (
            <div className="chatW-mediaViewerThumbs">
              {items.map((item, index) => (
                <button
                  key={item.id || `${item.url}-${index}`}
                  type="button"
                  className={`chatW-mediaViewerThumb ${index === activeIndex ? 'is-active' : ''}`}
                  onClick={() => selectViewerIndex(index)}
                  aria-label={`Открыть медиа ${index + 1}`}
                >
                  {item.type === 'video' ? <video src={item.url} muted playsInline preload="metadata" /> : <img src={item.thumbUrl || item.url} alt="" loading="lazy" draggable={false} />}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TimelineMessageItem(props) {
  const {
    item,
    onOpenMedia,
    selectedMessageId,
    focusedMessageId,
    selectedMessageIds,
    messageSelectionMode,
    interactionMode,
    setSelectedMessageId,
    toggleMessageSelection,
    conversationSearchResults,
    conversationSearchFocusedMessageId,
    globalSearchFocusedMessageId,
    retryFailedMessage,
    dismissFailedMessage,
    onReplyMessageItem,
    onJumpToMessage,
    onQuickReact,
    disableMessageActions,
  } = props;
  const itemIdentity = String(item.id || item.client_id || '');
  const selected = item.id === selectedMessageId || item.client_id === selectedMessageId;
  const multiSelected = selectedMessageIds.includes(itemIdentity);
  const isSelectionBlocked = messageSelectionMode && !canBatchSelectMessage(item);
  const isSearchHit = conversationSearchResults.some((result) => result.message_id === item.id);
  const isSearchCurrent = (Boolean(conversationSearchFocusedMessageId) && conversationSearchFocusedMessageId === item.id)
    || (Boolean(globalSearchFocusedMessageId) && globalSearchFocusedMessageId === item.id);
  const isFocusTarget = Boolean(focusedMessageId)
    && (focusedMessageId === item.id || focusedMessageId === item.client_id);
  const voiceDurationSec = Number(item.media?.durationSec || item.media?.duration || item.media?.durationSeconds || 0) || 0;
  const compactVoiceMeta = item.type === 'voice';
  const capabilities = useMemo(() => getMessageCapabilities(item), [item]);
  const [quickReactionBurst, setQuickReactionBurst] = useState(null);

  useEffect(() => {
    if (!quickReactionBurst) return undefined;
    const timer = window.setTimeout(() => setQuickReactionBurst(null), 760);
    return () => window.clearTimeout(timer);
  }, [quickReactionBurst]);

  const triggerQuickReaction = (targetItem, emoji) => {
    setQuickReactionBurst(emoji || '❤️');
    onQuickReact?.(targetItem, emoji || '❤️');
  };

  const openActions = () => {
    if (disableMessageActions) return;
    if (messageSelectionMode) {
      toggleMessageSelection(item);
      return;
    }
    setSelectedMessageId(item.id || item.client_id);
  };

  const { bubbleBindings, actionTriggerBindings, interactionState } = useMessageInteractions({
    item,
    interactionMode,
    capabilities,
    isInteractiveTarget: isInteractiveMessageTarget,
    onOpenActions: openActions,
    onToggleSelection: toggleMessageSelection,
    onPrimaryTap: (targetItem) => {
      if (capabilities.canOpenMedia) onOpenMedia?.(targetItem, 0);
    },
    onQuickReact: triggerQuickReaction,
    onSwipeReply: onReplyMessageItem,
  });

  return (
    <div className={`chatW-row ${item.direction === 'outgoing' ? 'is-outgoing' : 'is-incoming'} ${messageSelectionMode ? 'is-selection-mode' : ''}`}>
      <div
        data-message-id={item.id || item.client_id}
        className={`chatW-bubble ${item.direction === 'outgoing' ? 'is-outgoing' : 'is-incoming'} ${selected ? 'is-selected' : ''} ${multiSelected ? 'is-multi-selected' : ''} ${messageSelectionMode ? 'is-selection-mode' : ''} ${isSelectionBlocked ? 'is-selection-blocked' : ''} ${isSearchHit ? 'is-search-hit' : ''} ${isSearchCurrent ? 'is-search-current' : ''} ${isFocusTarget ? 'is-focus-target' : ''} ${interactionState?.isSwiping ? 'is-swiping' : ''} ${interactionState?.showSwipeReplyHint ? 'is-swipe-ready' : ''} ${interactionState?.isPressing ? 'is-pressing' : ''}`}
        style={interactionState?.swipeOffset ? { transform: `translateX(${interactionState.swipeOffset}px)` } : undefined}
        {...bubbleBindings}
      >
        {interactionState?.isSwiping ? (
          <div className={`chatW-swipeReplyHint ${interactionState?.showSwipeReplyHint ? 'is-ready' : ''}`} aria-hidden="true">↩ Ответить</div>
        ) : null}
        {quickReactionBurst ? <div className="chatW-quickReactionBurst" aria-hidden="true">{quickReactionBurst}</div> : null}

        {messageSelectionMode ? (
          <button
            type="button"
            className={`chatW-selectionChip ${multiSelected ? 'is-selected' : ''}`}
            disabled={isSelectionBlocked}
            onClick={(event) => {
              event.stopPropagation();
              toggleMessageSelection(item);
            }}
          >
            {multiSelected ? '✓' : '+'}
          </button>
        ) : null}
        {!messageSelectionMode && capabilities.showActionTrigger ? (
          <button
            type="button"
            className={`chatW-bubbleToolsTrigger ${selected ? 'is-active' : ''}`}
            aria-label="Действия с сообщением"
            {...actionTriggerBindings}
          >
            <MoreIcon />
          </button>
        ) : null}
        {item.forwarded_from ? (
          <div className="chatW-forwardMini">
            <strong>Переслано от: {item.forwarded_from.sender_name || 'Пользователь'}</strong>
            <span>{item.forwarded_from.preview_text}</span>
          </div>
        ) : null}
        {item.is_pinned ? <div className="chatW-messagePinBadge">Закреплено</div> : null}
        {item.reply_to ? (
          <button
            type="button"
            className={`chatW-reply ${item.reply_to?.id ? 'is-clickable' : ''} ${messageSelectionMode ? 'is-disabled' : ''}`.trim()}
            onClick={(event) => {
              event.stopPropagation();
              if (messageSelectionMode) {
                toggleMessageSelection(item, { silentBlocked: true });
                return;
              }
              if (item.reply_to?.id) onJumpToMessage?.(item.reply_to.id, { focus: true });
            }}
            disabled={messageSelectionMode || !item.reply_to?.id}
          >
            <strong>{item.reply_to.author}</strong>
            <span>{item.reply_to.text}</span>
          </button>
        ) : null}
        {item.story_ref && ['story_reply', 'shared_story'].includes(String(item.type || '').toLowerCase()) ? (
          <StoryReferenceCard item={item} messageSelectionMode={messageSelectionMode} />
        ) : null}
        {item.media?.url && item.type === 'image' ? (
          <button
            type="button"
            className="chatW-mediaTile chatW-mediaTile-image"
            onClick={(event) => {
              event.stopPropagation();
              if (messageSelectionMode) return;
              onOpenMedia?.(item, 0);
            }}
            disabled={messageSelectionMode}
          >
            <img className="chatW-media chatW-media-image" src={item.media.url} alt={item.text || 'Изображение'} loading="lazy" draggable={false} />
            <span className="chatW-mediaTileKind">Фото</span>
          </button>
        ) : null}
        {item.media?.url && item.type === 'video' ? (
          <button
            type="button"
            className="chatW-mediaTile chatW-mediaTile-video"
            onClick={(event) => {
              event.stopPropagation();
              if (messageSelectionMode) return;
              onOpenMedia?.(item, 0);
            }}
            disabled={messageSelectionMode}
          >
            <video className="chatW-media chatW-media-video" src={item.media.url} muted playsInline preload="metadata" />
            <span className="chatW-mediaTileKind">Видео</span>
            <span className="chatW-mediaTilePlay">▶</span>
          </button>
        ) : null}
        {item.media?.url && item.type === 'video_note' ? (
          <VideoNotePlayer
            src={item.media.url}
            direction={item.direction}
            disabled={messageSelectionMode}
          />
        ) : null}
        {item.media?.url && item.type === 'voice' ? (
          <VoiceMessagePlayer
            src={item.media.url}
            durationMs={voiceDurationSec * 1000}
            direction={item.direction}
            waveform={item.media?.waveform || item.metadata?.media?.waveform || null}
            disabled={messageSelectionMode}
          />
        ) : null}
        {item.media?.url && item.type === 'file' ? (
          <MessageFileCard item={item} messageSelectionMode={messageSelectionMode} />
        ) : null}
        {item.is_encrypted ? <div className="chatW-encrypted-badge">Сквозное шифрование</div> : null}
        {item.text ? <div className="chatW-bubble-text">{item.text}</div> : null}
        {!item.text && !item.media && item.preview_text ? <div className="chatW-bubble-text">{item.preview_text}</div> : null}
        {Array.isArray(item.reactions) && item.reactions.length ? (
          <div className="reactions-bar" onClick={(event) => event.stopPropagation()}>
            {item.reactions.map((reaction) => (
              <button
                key={`${itemIdentity}-${reaction.emoji}`}
                type="button"
                className={`reaction-pill ${reaction.reacted_by_me ? 'me' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  triggerQuickReaction(item, reaction.emoji);
                }}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className={`chatW-bubble-meta ${compactVoiceMeta ? 'is-voiceMeta' : ''}`.trim()}>
          <span>{item.time}</span>
          {item.edited ? <span>{compactVoiceMeta ? 'ред.' : 'изменено'}</span> : null}
          {!compactVoiceMeta && item.is_pinned ? <span>закреплено</span> : null}
          {!compactVoiceMeta && item.is_saved ? <span>сохранено</span> : null}
          {!compactVoiceMeta && item.reported_by_me ? <span>жалоба отправлена</span> : null}
          {item.direction === 'outgoing' ? <Checks state={item.state} /> : null}
        </div>
        {item.direction === 'outgoing' && item.state === 'failed' ? (
          <div className="chatW-failedInline">
            <span>{item.send_error || 'Сообщение не отправилось.'}</span>
            <div className="chatW-failedInlineActions">
              <button type="button" onClick={(event) => { event.stopPropagation(); retryFailedMessage(item); }}>Повторить</button>
              <button type="button" onClick={(event) => { event.stopPropagation(); dismissFailedMessage(item); }}>Убрать</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
export default function ChatConversationWorkspace({
  showList,
  setShowList,
  headerMeta,
  compactHeaderStatus,
  realtimeState,
  canOpenPeerProfile = false,
  onOpenPeerProfile,
  conversationSearchOpen,
  openConversationSearch,
  startConversationCall,
  callStartDisabled,
  mediaDiagnostics,
  hasDetectedCamera,
  chatMenuWrapRef,
  toggleChatMenu,
  chatMenuOpen,
  toggleChatPreference,
  conversationSearchInputRef,
  conversationSearchQuery,
  setConversationSearchQuery,
  stepConversationSearchResult,
  conversationSearchType,
  setConversationSearchType,
  conversationSearchLoading,
  conversationSearchResults,
  conversationSearchCurrentIndex,
  conversationSearchError,
  conversationSearchNotice,
  goToConversationSearchResult,
  timelineRef,
  activeChatUnreadCount,
  unreadAnchorMessageId,
  jumpToUnread,
  jumpToLatest,
  messageSelectionMode,
  interactionMode,
  usingFallback,
  messageSelectionNotice,
  selectedMessages,
  hasMoreSelectableLoaded,
  selectableLoadedMessages,
  selectAllLoadedMessages,
  forwardSubmitting,
  messageBatchActionLoading,
  allLoadedSelectableChosen,
  selectableLoadedMessageIds,
  clearMessageSelection,
  shouldHidePinnedDuringSwitch,
  activePinnedEntry,
  openPinnedMessage,
  pinnedMessages,
  pinnedCurrentIndex,
  stepPinnedMessage,
  openPinnedPanel,
  pinnedMessagesLoading,
  videoCallFallbackVisible,
  videoCallFallback,
  startAudioFallbackCall,
  activeChatId,
  callActionLoading,
  rerunVideoAvailabilityCheck,
  dismissVideoCallFallback,
  activeCall,
  callBannerTitle,
  callBannerText,
  callViewer,
  handleCallAction,
  canToggleCallMic,
  canToggleCallCamera,
  callClientError,
  callClientStatus,
  hasLiveCall,
  localCallReady,
  remoteCallReady,
  remoteCallAudioRef,
  remoteCallVideoRef,
  localCallVideoRef,
  canLoadMore,
  loadingOlder,
  loadMessages,
  nextCursor,
  showTimelineSkeleton,
  loadingMessages,
  errorText,
  timelineItems,
  selectedMessageId,
  focusedMessageId,
  setSelectedMessageId,
  selectedMessageIds,
  conversationSearchFocusedMessageId,
  globalSearchFocusedMessageId,
  toggleMessageSelection,
  retryFailedMessage,
  dismissFailedMessage,
  handleReplyFromTimelineItem,
  handleQuickReact,
  jumpToMessage,
  selectedMessage,
  selectedMessageActionText,
  handleRetryMessage,
  beginReplyMessage,
  composerMode,
  messageActionLoading,
  handleCopyMessage,
  openForwardSheet,
  beginMultiMessageSelection,
  beginEditMessage,
  handleToggleSaveMessage,
  handleTogglePinMessage,
  handleReportSelectedMessage,
  handleDeleteMessage,
  closeSelectedMessage,
  replyingTo,
  replyDraftPulseKey,
  setReplyingTo,
  forwardSheetOpen,
  forwardSourceMessages,
  closeForwardSheet,
  forwardTargetsQuery,
  setForwardTargetsQuery,
  selectedMessagePreviewItems,
  forwardTargetChats,
  forwardSelectedChatIds,
  toggleForwardChatSelection,
  forwardComment,
  setForwardComment,
  handleForwardSelectedMessage,
  pinnedPanelOpen,
  closePinnedPanel,
  setPinnedCurrentIndex,
  attachmentSheetOpen,
  setAttachmentSheetOpen,
  launchAttachmentPicker,
  cancelComposerAction,
  videoNoteState,
  videoNoteLiveRef,
  closeVideoNoteRecorder,
  startVideoNoteRecording,
  stopVideoNoteRecording,
  retakeVideoNote,
  sendVideoNote,
  isDebugChat,
  runMediaProbe,
  refreshMediaProbeDiagnostics,
  openVideoNoteRecorder,
  voiceRecorderState,
  closeVoiceRecorder,
  stopVoiceRecording,
  retakeVoiceRecording,
  sendVoiceRecording,
  openVoiceRecorder,
  mediaProbeState,
  closeMediaProbe,
  pendingAttachment,
  pendingAttachments = [],
  readyAttachmentCount = 0,
  failedAttachmentCount = 0,
  isAttachmentUploading,
  hasReadyAttachment,
  hasFailedAttachment,
  draftState,
  uploadingAttachment,
  retryPendingAttachment,
  clearPendingAttachment,
  fileInputRef,
  handleAttachmentChange,
  openAttachmentPicker,
  composeBlockedByRequest,
  conversationRequestState,
  activeIncomingRequest,
  handleRequestAction,
  message,
  setMessage,
  handleSend,
  composerSendBlocked,
  selectedSavableMessages,
  handleBatchToggleSaveSelectedMessages,
  selectedUnsavableMessages,
  selectedDeletableMessages,
  handleBatchDeleteSelectedMessages,
  disableMessageActions = false,
}) {
  const [showJumpLatest, setShowJumpLatest] = useState(false);
  const [mediaViewerState, setMediaViewerState] = useState({ open: false, items: [], index: 0 });
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [mediaHubOpen, setMediaHubOpen] = useState(false);
  const [mediaHubFilter, setMediaHubFilter] = useState('all');

  const composerAttachments = Array.isArray(pendingAttachments) ? pendingAttachments : [];
  const hasPendingAttachments = composerAttachments.length > 0;
  const replyDraftMeta = useMemo(() => {
    if (!replyingTo) return [];
    const bits = [];
    if (replyingTo.type && !['text'].includes(String(replyingTo.type))) {
      bits.push(mediaPreviewLabel(replyingTo.type, null));
    }
    if (replyingTo.isEncrypted) bits.push('Защищено');
    return bits;
  }, [mediaPreviewLabel, replyingTo]);
  const selectionSummaryChips = useMemo(() => {
    const chips = [];
    if (Array.isArray(forwardSourceMessages) && forwardSourceMessages.length) chips.push(`Переслать: ${forwardSourceMessages.length}`);
    if (Array.isArray(selectedSavableMessages) && selectedSavableMessages.length) chips.push(`Сохранить: ${selectedSavableMessages.length}`);
    if (Array.isArray(selectedUnsavableMessages) && selectedUnsavableMessages.length) chips.push(`Убрать: ${selectedUnsavableMessages.length}`);
    if (Array.isArray(selectedDeletableMessages) && selectedDeletableMessages.length) chips.push(`Удалить: ${selectedDeletableMessages.length}`);
    return chips.slice(0, 4);
  }, [forwardSourceMessages, selectedDeletableMessages, selectedSavableMessages, selectedUnsavableMessages]);
  const normalizedRequestState = useMemo(() => normalizeConversationRequestState(conversationRequestState), [conversationRequestState]);
  const requestMeta = useMemo(() => getConversationRequestMeta(normalizedRequestState), [normalizedRequestState]);
  const mediaHubItems = useMemo(() => {
    const bucket = [];
    const pushItem = (candidate) => {
      const kind = classifyMediaHubItem(candidate);
      if (!kind) return;
      bucket.push({
        id: candidate?.id || candidate?.client_id || `${kind}-${bucket.length}`,
        kind,
        item: candidate,
        title: candidate?.text || candidate?.preview_text || mediaPreviewLabel(candidate?.type, candidate?.media),
        subtitle: candidate?.sender?.name || (candidate?.direction === 'outgoing' ? 'Вы' : 'Пользователь'),
        time: candidate?.time || '',
        url: candidate?.media?.url || '',
        thumbUrl: candidate?.media?.thumb_url || candidate?.media?.thumbUrl || candidate?.media?.url || '',
      });
    };
    (Array.isArray(timelineItems) ? timelineItems : []).forEach((entry) => {
      if (!entry || entry.kind === 'divider') return;
      if (entry.kind === 'media-cluster') {
        (Array.isArray(entry.items) ? entry.items : []).forEach(pushItem);
        return;
      }
      pushItem(entry);
    });
    const seen = new Set();
    return bucket.filter((entry) => {
      const key = String(entry.id || entry.url || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [timelineItems]);
  const mediaHubFilteredItems = useMemo(() => {
    if (mediaHubFilter === 'all') return mediaHubItems;
    return mediaHubItems.filter((entry) => entry.kind === mediaHubFilter);
  }, [mediaHubFilter, mediaHubItems]);

  const openMediaViewer = (items, index = 0) => {
    const prepared = Array.isArray(items) && items.length && items[0]?.url ? items : buildMediaViewerEntries(items);
    if (!prepared.length) return;
    setMediaViewerState({ open: true, items: prepared, index: Math.max(0, Math.min(prepared.length - 1, Number(index || 0) || 0)) });
  };

  const closeMediaViewer = () => setMediaViewerState({ open: false, items: [], index: 0 });
  const stepMediaViewer = (delta) => {
    setMediaViewerState((prev) => {
      if (!prev.open || !prev.items.length) return prev;
      const nextIndex = (prev.index + delta + prev.items.length) % prev.items.length;
      return { ...prev, index: nextIndex };
    });
  };
  const selectMediaViewerIndex = (index) => {
    setMediaViewerState((prev) => ({ ...prev, index: Math.max(0, Math.min(prev.items.length - 1, Number(index || 0) || 0)) }));
  };

  useEffect(() => {
    const node = timelineRef?.current;
    if (!node) return undefined;
    const sync = () => {
      const distanceFromBottom = Math.max(0, node.scrollHeight - node.clientHeight - node.scrollTop);
      setShowJumpLatest(distanceFromBottom > 160);
    };
    sync();
    node.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      node.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [timelineRef, timelineItems.length, activeChatId]);

  useEffect(() => {
    if (!(infoPanelOpen || mediaHubOpen)) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (mediaHubOpen) {
        setMediaHubOpen(false);
        return;
      }
      if (infoPanelOpen) setInfoPanelOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [infoPanelOpen, mediaHubOpen]);

  useEffect(() => {
    if (!mediaViewerState.open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeMediaViewer();
      else if (event.key === 'ArrowRight') stepMediaViewer(1);
      else if (event.key === 'ArrowLeft') stepMediaViewer(-1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mediaViewerState.open]);

  useEffect(() => {
    setInfoPanelOpen(false);
    setMediaHubOpen(false);
    setMediaHubFilter('all');
  }, [activeChatId]);

  useEffect(() => {
    if (!(mediaViewerState.open || infoPanelOpen || mediaHubOpen)) return undefined;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [infoPanelOpen, mediaHubOpen, mediaViewerState.open]);

  const hasConversationError = Boolean(errorText && String(errorText).trim());

  const requestCardActions = normalizedRequestState === 'incoming' && activeIncomingRequest ? (
    <div className="chatW-requestGateActions">
      <button type="button" className="chatW-requestGateBtn is-primary" onClick={() => handleRequestAction?.(activeIncomingRequest.id, 'accept', activeIncomingRequest.conversation_id)}>
        Принять
      </button>
      <button type="button" className="chatW-requestGateBtn" onClick={() => handleRequestAction?.(activeIncomingRequest.id, 'reject')}>
        Отклонить
      </button>
      <button type="button" className="chatW-requestGateBtn is-danger" onClick={() => handleRequestAction?.(activeIncomingRequest.id, 'block')}>
        Заблокировать
      </button>
    </div>
  ) : null;

  const composerPlaceholder = composerMode === 'edit'
    ? 'Измените сообщение'
    : requestMeta?.placeholder
      ? requestMeta.placeholder
      : hasFailedAttachment
        ? 'Повтори загрузку или убери вложения'
        : (hasPendingAttachments ? 'Подпись к вложениям' : 'Сообщение');

  return (
    <section className={`chatW-dialog ${showList ? 'is-mobile-hidden' : 'is-mobile-visible'}`}>
      <div className="chatW-dialog-head">
        <div className="chatW-dialog-head-left">
          <button className="chatW-icon-btn mobile-only" type="button" onClick={() => setShowList(true)} aria-label="Назад к чатам">
            <BackIcon />
          </button>
          {canOpenPeerProfile ? (
            <button type="button" className="chatW-dialogPeer" onClick={onOpenPeerProfile} aria-label={`Открыть профиль: ${headerMeta?.name || 'собеседник'}`}>
              <span className={`chatW-avatar is-${headerMeta?.tone || 'violet'} is-large`}>{headerMeta?.initials || 'Ч'}</span>
              <span className="chatW-dialogPeerMeta">
                <span className="chatW-dialog-name">{headerMeta?.name || 'Диалог'}</span>
                <span className="chatW-dialog-status">{compactHeaderStatus}</span>
              </span>
            </button>
          ) : (
            <div className="chatW-dialogPeer is-static">
              <span className={`chatW-avatar is-${headerMeta?.tone || 'violet'} is-large`}>{headerMeta?.initials || 'Ч'}</span>
              <span className="chatW-dialogPeerMeta">
                <span className="chatW-dialog-name">{headerMeta?.name || 'Диалог'}</span>
                <span className="chatW-dialog-status">{compactHeaderStatus}</span>
              </span>
            </div>
          )}
        </div>
        <div className="chatW-dialog-actions">
          <button className={`chatW-icon-btn ${conversationSearchOpen ? 'is-active' : ''}`} type="button" aria-label="Поиск по переписке" onClick={openConversationSearch}><SearchIcon /></button>
          <button className="chatW-icon-btn" type="button" aria-label="Аудиозвонок" onClick={() => startConversationCall('audio')} disabled={callStartDisabled}><PhoneIcon /></button>
          <button className="chatW-icon-btn" type="button" aria-label="Видеозвонок" onClick={() => startConversationCall('video')} disabled={callStartDisabled} title={mediaDiagnostics && !hasDetectedCamera ? 'Камера не найдена. Подключите её и попробуйте снова.' : ''}><CameraIcon /></button>
          <div className="chatW-menuwrap" ref={chatMenuWrapRef}>
            <button className="chatW-icon-btn" type="button" aria-label="Меню" onClick={toggleChatMenu}><MoreIcon /></button>
            {chatMenuOpen ? (
              <div className="chatW-menudrop">
                <button type="button" onClick={() => { setInfoPanelOpen(true); toggleChatMenu(); }}>Информация о диалоге</button>
                <button type="button" onClick={() => { setMediaHubOpen(true); toggleChatMenu(); }}>Медиахаб</button>
                <button type="button" onClick={() => { openPinnedPanel?.(); toggleChatMenu(); }}>Закреплённые</button>
                <button type="button" onClick={() => toggleChatPreference('pin', !headerMeta?.pinned)}>{headerMeta?.pinned ? 'Убрать из закреплённых' : 'Закрепить чат'}</button>
                <button type="button" onClick={() => toggleChatPreference('mute', !headerMeta?.muted)}>{headerMeta?.muted ? 'Включить уведомления' : 'Отключить уведомления'}</button>
                <button type="button" onClick={() => toggleChatPreference('archive', !headerMeta?.archived)}>{headerMeta?.archived ? 'Вернуть из архива' : 'Архивировать чат'}</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {conversationSearchOpen ? (
        <div className="chatW-dialogSearch">
          <div className="chatW-dialogSearchRow">
            <div className="chatW-dialogSearchInput">
              <SearchIcon />
              <input
                ref={conversationSearchInputRef}
                type="text"
                placeholder="Поиск внутри чата"
                value={conversationSearchQuery}
                onChange={(event) => setConversationSearchQuery(event.target.value)}
              />
              {conversationSearchQuery ? <button type="button" className="chatW-dialogSearchClear" onClick={() => setConversationSearchQuery('')} aria-label="Очистить поиск">×</button> : null}
            </div>
            <div className="chatW-dialogSearchNav">
              <button type="button" onClick={() => stepConversationSearchResult(-1)} disabled={!conversationSearchResults.length || conversationSearchLoading} aria-label="Предыдущее совпадение">↑</button>
              <button type="button" onClick={() => stepConversationSearchResult(1)} disabled={!conversationSearchResults.length || conversationSearchLoading} aria-label="Следующее совпадение">↓</button>
            </div>
          </div>
          <div className="chatW-searchFilterRow">
            {MESSAGE_SEARCH_FILTERS.map((filter) => (
              <button
                key={`conversation-filter-${filter.id || 'all'}`}
                type="button"
                className={`chatW-searchFilterChip ${conversationSearchType === filter.id ? 'is-active' : ''}`}
                onClick={() => setConversationSearchType(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="chatW-dialogSearchMeta">
            <span>
              {conversationSearchLoading
                ? 'Ищу сообщения…'
                : conversationSearchQuery.trim().length < 2 && !conversationSearchType
                  ? 'Введите минимум 2 символа или выберите фильтр.'
                  : conversationSearchResults.length
                    ? `Найдено: ${conversationSearchResults.length}${conversationSearchType ? ` · ${searchFilterLabel(conversationSearchType)}` : ''}`
                    : `Совпадений пока нет${conversationSearchType ? ` · ${searchFilterLabel(conversationSearchType)}` : ''}.`}
            </span>
            {conversationSearchResults.length ? <span>{conversationSearchCurrentIndex + 1}/{conversationSearchResults.length}</span> : null}
          </div>
          {conversationSearchError ? <div className="chatW-dialogSearchError">{conversationSearchError}</div> : null}
          {conversationSearchNotice ? <div className="chatW-dialogSearchNote">{conversationSearchNotice}</div> : null}
          {conversationSearchResults.length ? (
            <div className="chatW-dialogSearchResults">
              {conversationSearchResults.slice(0, 6).map((result, index) => (
                <button
                  key={result.message_id}
                  type="button"
                  className={`chatW-dialogSearchResult ${index === conversationSearchCurrentIndex ? 'is-active' : ''}`}
                  onClick={() => goToConversationSearchResult(index)}
                >
                  <strong>{result.sender?.name || (result.is_mine ? 'Вы' : 'Пользователь')}</strong>
                  <span>{result.snippet || result.preview_text || 'Сообщение'}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="chatW-timeline" ref={timelineRef}>
        {messageSelectionMode && !usingFallback ? (
          <div className={`chatW-selectionSticky ${messageSelectionNotice ? 'has-note' : ''}`}>
            <div className="chatW-selectionStickyMain">
              <strong>{selectedMessages.length > 1 ? `Выбрано сообщений: ${selectedMessages.length}` : 'Выбрано 1 сообщение'}</strong>
              <span>{messageSelectionNotice || (hasMoreSelectableLoaded ? `В загруженной части доступно ${selectableLoadedMessages.length} подходящих сообщений. Можно выбрать до ${MAX_BATCH_MESSAGE_SELECTION}.` : 'Можно быстро переслать, сохранить или удалить выбранные сообщения.')}</span>
              {selectionSummaryChips.length ? (
                <div className="chatW-selectionStickyChips">
                  {selectionSummaryChips.map((item) => <span key={item} className="chatW-selectionStickyChip">{item}</span>)}
                </div>
              ) : null}
            </div>
            <div className="chatW-selectionStickyActions">
              <button type="button" onClick={selectAllLoadedMessages} disabled={forwardSubmitting || messageBatchActionLoading || allLoadedSelectableChosen || !selectableLoadedMessageIds.length}>
                {hasMoreSelectableLoaded ? `Первые ${MAX_BATCH_MESSAGE_SELECTION}` : 'Выбрать всё'}
              </button>
              <button type="button" onClick={clearMessageSelection} disabled={forwardSubmitting || messageBatchActionLoading}>Снять выбор</button>
            </div>
          </div>
        ) : null}
        {headerMeta?.pinned || headerMeta?.muted || headerMeta?.archived ? (
          <div className="chatW-stateRow">
            {headerMeta?.pinned ? <span className="chatW-flag">Закреплён</span> : null}
            {headerMeta?.muted ? <span className="chatW-flag is-muted">Без звука</span> : null}
            {headerMeta?.archived ? <span className="chatW-flag">В архиве</span> : null}
          </div>
        ) : null}
        {realtimeState?.status && realtimeState.status !== 'idle' ? (
          <div className="chatW-stateRow">
            <span className={`chatW-flag ${realtimeState.status === 'reconnecting' ? 'is-warning' : realtimeState.status === 'syncing' ? 'is-info' : 'is-success'}`}>
              {realtimeState.status === 'reconnecting' ? 'Realtime' : realtimeState.status === 'syncing' ? 'Синхронизация' : 'Realtime OK'}
            </span>
            {realtimeState.text ? <span className="chatW-stateHint">{realtimeState.text}</span> : null}
          </div>
        ) : null}
        {hasConversationError ? (
          <div className="chatW-stateRow">
            <span className="chatW-flag is-warning">Нужна проверка</span>
            <span className="chatW-stateHint">{errorText}</span>
          </div>
        ) : null}
        {requestMeta ? (
          <div className={`chatW-requestGateCard is-${requestMeta.tone}`}>
            <div className="chatW-requestGateCopy">
              <strong>{requestMeta.title}</strong>
              <span>{requestMeta.text}</span>
            </div>
            {requestCardActions}
          </div>
        ) : null}
        {!shouldHidePinnedDuringSwitch && activePinnedEntry ? (
          <div className="chatW-pinnedBar">
            <button type="button" className="chatW-pinnedBarMain" onClick={() => openPinnedMessage(activePinnedEntry.message?.id)} disabled={!activePinnedEntry.message?.id}>
              <div className="chatW-pinnedBarLabel">Закреп{pinnedMessages.length > 1 ? ` ${pinnedCurrentIndex + 1}/${pinnedMessages.length}` : ''}</div>
              <div className="chatW-pinnedBarText">{activePinnedEntry.message?.forwarded_from?.preview_text || activePinnedEntry.message?.text || activePinnedEntry.message?.preview_text || mediaPreviewLabel(activePinnedEntry.message?.type, activePinnedEntry.message?.media)}</div>
            </button>
            {pinnedMessages.length > 1 ? (
              <div className="chatW-pinnedBarNav">
                <button type="button" onClick={() => stepPinnedMessage(-1)} aria-label="Предыдущий закреп">‹</button>
                <button type="button" onClick={() => stepPinnedMessage(1)} aria-label="Следующий закреп">›</button>
              </div>
            ) : null}
            <button type="button" className="chatW-pinnedBarOpen" onClick={openPinnedPanel}>{pinnedMessages.length > 1 ? 'Все' : 'Открыть'}</button>
          </div>
        ) : (!pinnedMessagesLoading && !usingFallback ? null : null)}
        {videoCallFallbackVisible ? (
          <div className="chatW-inlineBanner">
            <div className="chatW-inlineBannerText">
              <strong>{videoCallFallback.title || 'Видеозвонок недоступен'}</strong>
              <span>{videoCallFallback.message}</span>
            </div>
            <div className="chatW-inlineBannerActions">
              <button type="button" onClick={startAudioFallbackCall} disabled={!activeChatId || callActionLoading}>Начать аудиозвонок</button>
              <button type="button" onClick={() => rerunVideoAvailabilityCheck().catch(() => null)} disabled={callActionLoading}>Повторить поиск камеры</button>
              <button type="button" onClick={dismissVideoCallFallback}>Скрыть</button>
            </div>
          </div>
        ) : null}
        {activeCall ? (
          <>
            <div className={`chatW-inlineBanner ${activeCall.status === 'active' ? 'is-active' : ''}`}>
              <div className="chatW-inlineBannerText">
                <strong>{callBannerTitle}</strong>
                <span>{callBannerText}</span>
              </div>
              <div className="chatW-inlineBannerActions">
                {callViewer?.can_accept ? <button type="button" onClick={() => handleCallAction('accept')} disabled={callActionLoading}>Принять</button> : null}
                {callViewer?.can_reject ? <button type="button" onClick={() => handleCallAction('reject')} disabled={callActionLoading}>Отклонить</button> : null}
                {callViewer?.can_busy ? <button type="button" onClick={() => handleCallAction('busy')} disabled={callActionLoading}>Занят</button> : null}
                {callViewer?.can_cancel ? <button type="button" onClick={() => handleCallAction('cancel')} disabled={callActionLoading}>Отменить</button> : null}
                {callViewer?.can_end ? <button type="button" onClick={() => handleCallAction('end')} disabled={callActionLoading}>Завершить</button> : null}
                {canToggleCallMic ? <button type="button" onClick={() => handleCallAction('toggle', { isMicOn: !callViewer.is_mic_on })} disabled={callActionLoading}>{callViewer.is_mic_on ? 'Выключить микрофон' : 'Включить микрофон'}</button> : null}
                {canToggleCallCamera ? <button type="button" onClick={() => handleCallAction('toggle', { isCameraOn: !callViewer.is_camera_on })} disabled={callActionLoading}>{callViewer.is_camera_on ? 'Выключить камеру' : 'Включить камеру'}</button> : null}
              </div>
            </div>
            <div className="chatW-callpanel">
              <div className="chatW-callpanel-head">
                <div>
                  <strong>{activeCall.type === 'video' ? 'Видеозвонок' : 'Аудиозвонок'}</strong>
                  <span>{callClientError || callClientStatus || (hasLiveCall ? 'Подключаемся…' : 'Синхронизируем состояние звонка.')}</span>
                </div>
                <div className="chatW-callpanel-badges">
                  <span className={`chatW-flag ${localCallReady ? 'is-live' : ''}`}>{localCallReady ? 'Моё медиа готово' : 'Медиа не готово'}</span>
                  <span className={`chatW-flag ${remoteCallReady ? 'is-live' : ''}`}>{remoteCallReady ? 'Собеседник подключён' : 'Ждём собеседника'}</span>
                </div>
              </div>
              {callClientError ? <div className="chatW-callpanel-error">{callClientError}</div> : null}
              <div className={`chatW-callstage ${activeCall.type === 'video' ? 'is-video' : 'is-audio'}`}>
                <audio ref={remoteCallAudioRef} autoPlay playsInline />
                {activeCall.type === 'video' ? (
                  <>
                    <div className="chatW-callvideo chatW-callvideo-remote">
                      <video ref={remoteCallVideoRef} autoPlay playsInline />
                      {!remoteCallReady ? <div className="chatW-callvideo-placeholder">Ждём видео собеседника…</div> : null}
                    </div>
                    <div className="chatW-callvideo chatW-callvideo-local">
                      <video ref={localCallVideoRef} autoPlay muted playsInline />
                      {!localCallReady ? <div className="chatW-callvideo-placeholder">Готовим вашу камеру…</div> : null}
                    </div>
                  </>
                ) : (
                  <div className="chatW-callaudio-state">
                    <div className={`chatW-callaudio-orb ${remoteCallReady ? 'is-live' : ''}`}></div>
                    <div>
                      <strong>{remoteCallReady ? 'Аудиоканал подключён' : 'Ожидаем аудиоканал собеседника'}</strong>
                      <span>{localCallReady ? 'Микрофон готов. Можно говорить.' : 'Подключаем ваш микрофон…'}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}
        {canLoadMore ? (
          <button className="chatW-loadmore" type="button" disabled={loadingOlder} onClick={() => loadMessages(activeChatId, { cursor: nextCursor, mode: 'prepend' })}>
            {loadingOlder ? 'Загружаю историю…' : 'Показать более ранние сообщения'}
          </button>
        ) : null}
        {showTimelineSkeleton ? (
          <div className="chatW-timelineLoading" aria-live="polite">
            <div className="chatW-skeletonRow medium" />
            <div className="chatW-skeletonRow short" />
            <div className="chatW-skeletonRow" />
            <div className="chatW-skeletonRow medium" />
            <div className="chatW-skeletonRow short" />
          </div>
        ) : null}
        {!showTimelineSkeleton && loadingMessages && !usingFallback && !timelineItems.length ? (
          <div className="chatW-emptyCard">
            <strong>Загружаю сообщения…</strong>
            <span>Собираем историю этого диалога.</span>
          </div>
        ) : null}
        {!showTimelineSkeleton && !loadingMessages && !timelineItems.length && hasConversationError ? (
          <div className="chatW-emptyCard is-muted">
            <strong>Не удалось обновить переписку</strong>
            <span>{errorText}</span>
          </div>
        ) : null}
        {!showTimelineSkeleton && !loadingMessages && !timelineItems.length && !hasConversationError ? (
          composeBlockedByRequest ? (
            <div className="chatW-emptyCard is-muted">
              <strong>Переписка пока ограничена</strong>
              <span>Новые сообщения станут доступны после принятия запроса или изменения настроек доступа.</span>
            </div>
          ) : (
            <div className="chatW-emptyCard">
              <strong>Начни разговор первым</strong>
              <span>Можно отправить текст, вложение, голосовое сообщение или видеокружок.</span>
            </div>
          )
        ) : null}
        {!showTimelineSkeleton && loadingMessages && !usingFallback && timelineItems.length ? <div className="chatW-inlineTimelineLoading">Обновляю диалог…</div> : null}
        {(showTimelineSkeleton ? [] : timelineItems).map((item) => {
          if (item.kind === 'divider') return <div key={item.id} className={`chatW-divider ${item.variant === 'unread' ? 'is-unread' : ''}`.trim()} data-unread-divider={item.variant === 'unread' ? 'true' : undefined}>{item.label}</div>;
          if (item.kind === 'media-cluster') {
            return <MediaClusterItem key={item.id} cluster={item} messageSelectionMode={messageSelectionMode} onOpenMedia={openMediaViewer} />;
          }
          return (
            <TimelineMessageItem
              key={item.id || item.client_id}
              item={item}
              onOpenMedia={openMediaViewer}
              selectedMessageId={selectedMessageId}
              focusedMessageId={focusedMessageId}
              selectedMessageIds={selectedMessageIds}
              messageSelectionMode={messageSelectionMode}
              interactionMode={interactionMode}
              setSelectedMessageId={setSelectedMessageId}
              toggleMessageSelection={toggleMessageSelection}
              conversationSearchResults={conversationSearchResults}
              conversationSearchFocusedMessageId={conversationSearchFocusedMessageId}
              globalSearchFocusedMessageId={globalSearchFocusedMessageId}
              retryFailedMessage={retryFailedMessage}
              dismissFailedMessage={dismissFailedMessage}
              onReplyMessageItem={handleReplyFromTimelineItem}
              onJumpToMessage={jumpToMessage}
              onQuickReact={handleQuickReact}
              disableMessageActions={disableMessageActions}
            />
          );
        })}
      </div>

      <MediaViewerOverlay
        viewerState={mediaViewerState}
        closeViewer={closeMediaViewer}
        stepViewer={stepMediaViewer}
        selectViewerIndex={selectMediaViewerIndex}
      />

      {infoPanelOpen ? (
        <div className="chatW-sheetBackdrop" onClick={() => setInfoPanelOpen(false)}>
          <div className="chatW-sheetPanel chatW-infoPanel" role="dialog" aria-modal="true" aria-label="Информация о диалоге" onClick={(event) => event.stopPropagation()}>
            <div className="chatW-sheetHandle" aria-hidden="true" />
            <div className="chatW-sheetHead">
              <div>
                <div className="chatW-sheetTitle">Информация о диалоге</div>
                <div className="chatW-sheetText">Быстрые переходы и статус этого чата.</div>
              </div>
              <button type="button" className="chatW-sheetClose" onClick={() => setInfoPanelOpen(false)} aria-label="Закрыть">×</button>
            </div>
            <div className="chatW-infoPanelHero">
              <span className={`chatW-avatar is-${headerMeta?.tone || 'violet'} is-large`}>{headerMeta?.initials || 'Ч'}</span>
              <div className="chatW-infoPanelHeroCopy">
                <strong>{headerMeta?.name || 'Диалог'}</strong>
                <span>{compactHeaderStatus || 'Статус скоро обновится'}</span>
              </div>
            </div>
            <div className="chatW-infoStats">
              <div className="chatW-infoStat"><span>Сообщения</span><strong>{mediaHubItems.length || timelineItems.filter((entry) => entry && entry.kind !== 'divider').length}</strong></div>
              <div className="chatW-infoStat"><span>Медиа</span><strong>{mediaHubItems.length}</strong></div>
              <div className="chatW-infoStat"><span>Закрепы</span><strong>{pinnedMessages.length}</strong></div>
            </div>
            {requestMeta ? (
              <div className={`chatW-infoNotice is-${requestMeta.tone}`}>
                <strong>{requestMeta.title}</strong>
                <span>{requestMeta.text}</span>
              </div>
            ) : null}
            {hasConversationError ? (
              <div className="chatW-infoNotice">
                <strong>Есть необработанная ошибка</strong>
                <span>{errorText}</span>
              </div>
            ) : null}
            <div className="chatW-sheetActionList">
              {canOpenPeerProfile ? <button type="button" className="chatW-sheetActionBtn" onClick={() => { setInfoPanelOpen(false); onOpenPeerProfile?.(); }}>Открыть профиль</button> : null}
              <button type="button" className="chatW-sheetActionBtn" onClick={() => { setInfoPanelOpen(false); openConversationSearch?.(); }}>Поиск по чату</button>
              <button type="button" className="chatW-sheetActionBtn" onClick={() => { setInfoPanelOpen(false); openPinnedPanel?.(); }}>Закреплённые сообщения</button>
              <button type="button" className="chatW-sheetActionBtn" onClick={() => { setInfoPanelOpen(false); setMediaHubOpen(true); }}>Медиахаб</button>
            </div>
            {requestCardActions ? <div className="chatW-requestGateInline">{requestCardActions}</div> : null}
          </div>
        </div>
      ) : null}

      {mediaHubOpen ? (
        <div className="chatW-sheetBackdrop" onClick={() => setMediaHubOpen(false)}>
          <div className="chatW-sheetPanel chatW-mediaHubPanel" role="dialog" aria-modal="true" aria-label="Медиахаб" onClick={(event) => event.stopPropagation()}>
            <div className="chatW-sheetHandle" aria-hidden="true" />
            <div className="chatW-sheetHead">
              <div>
                <div className="chatW-sheetTitle">Медиахаб</div>
                <div className="chatW-sheetText">Фото, видео, голосовые и файлы этого диалога.</div>
              </div>
              <button type="button" className="chatW-sheetClose" onClick={() => setMediaHubOpen(false)} aria-label="Закрыть">×</button>
            </div>
            <div className="chatW-mediaHubFilters">
              {[
                ['all', 'Все'],
                ['image', 'Фото'],
                ['video', 'Видео'],
                ['voice', 'Голосовые'],
                ['file', 'Файлы'],
              ].map(([key, label]) => (
                <button key={key} type="button" className={`chatW-mediaHubFilter ${mediaHubFilter === key ? 'is-active' : ''}`} onClick={() => setMediaHubFilter(key)}>{label}</button>
              ))}
            </div>
            {usingFallback ? <div className="chatW-infoNotice"><strong>Локальный режим</strong><span>Часть переходов к исходным сообщениям может быть ограничена, пока открыт fallback-режим.</span></div> : null}
            {hasConversationError ? <div className="chatW-infoNotice"><strong>Часть данных могла не догрузиться</strong><span>{errorText}</span></div> : null}
            {loadingMessages && !mediaHubItems.length ? (
              <div className="chatW-emptyCard"><strong>Собираем медиахаб…</strong><span>Загружаем историю сообщений и медиафайлы этого диалога.</span></div>
            ) : null}
            {!loadingMessages && !mediaHubFilteredItems.length ? (
              <div className="chatW-emptyCard is-muted"><strong>Пока пусто</strong><span>{mediaHubFilter === 'all' ? 'В этом диалоге ещё нет медиа и файлов.' : 'Для выбранного фильтра пока ничего не найдено.'}</span></div>
            ) : null}
            <div className="chatW-mediaHubList">
              {mediaHubFilteredItems.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="chatW-mediaHubItem"
                  onClick={() => {
                    setMediaHubOpen(false);
                    if (entry.item?.id) jumpToMessage?.(entry.item.id, { behavior: 'smooth' });
                    if (entry.kind === 'image' || entry.kind === 'video') {
                      setTimeout(() => openMediaViewer([entry.item], 0), 120);
                    }
                  }}
                >
                  <span className={`chatW-mediaHubThumb is-${entry.kind}`}>
                    {entry.kind === 'image' ? <img src={entry.thumbUrl || entry.url} alt="" loading="lazy" draggable={false} /> : null}
                    {entry.kind === 'video' ? (entry.thumbUrl || entry.url ? <video src={entry.thumbUrl || entry.url} muted playsInline preload="metadata" /> : <span>▶</span>) : null}
                    {entry.kind === 'voice' ? <span>🎙</span> : null}
                    {entry.kind === 'file' ? <span>📄</span> : null}
                  </span>
                  <span className="chatW-mediaHubMeta">
                    <strong>{entry.title}</strong>
                    <span>{entry.subtitle}</span>
                    <em>{entry.time || 'Без времени'}</em>
                  </span>
                  <span className="chatW-mediaHubJump">Открыть</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {(showJumpLatest || unreadAnchorMessageId) ? (
        <div className="chatW-jumpStack">
          {unreadAnchorMessageId ? (
            <button type="button" className="chatW-jumpBtn is-unread" onClick={jumpToUnread}>
              <span>Непрочитанные</span>
              {activeChatUnreadCount ? <strong>{activeChatUnreadCount}</strong> : null}
            </button>
          ) : null}
          {showJumpLatest ? (
            <button type="button" className="chatW-jumpBtn" onClick={jumpToLatest}><span>К последним</span><strong>↓</strong></button>
          ) : null}
        </div>
      ) : null}

      <div className="chatW-composer-wrap">
        {messageSelectionMode && !usingFallback ? (
          <div className="chatW-actionbar chatW-actionbar-selection">
            <div className="chatW-actionbar-text">
              {selectedMessages.length > 1 ? `Выбрано сообщений: ${selectedMessages.length}` : 'Выбрано 1 сообщение'}
            </div>
            <div className="chatW-actionbar-actions">
              <button type="button" onClick={selectAllLoadedMessages} disabled={forwardSubmitting || messageBatchActionLoading || allLoadedSelectableChosen || !selectableLoadedMessageIds.length}>
                {hasMoreSelectableLoaded ? `Первые ${MAX_BATCH_MESSAGE_SELECTION}` : 'Выбрать всё'}
              </button>
              {forwardSourceMessages.length ? (
                <button type="button" onClick={openForwardSheet} disabled={!forwardSourceMessages.length || forwardSubmitting || messageBatchActionLoading}>
                  {forwardSourceMessages.length !== selectedMessages.length && selectedMessages.length > forwardSourceMessages.length
                    ? `Переслать (${forwardSourceMessages.length} из ${selectedMessages.length})`
                    : (forwardSourceMessages.length > 1 ? `Переслать (${forwardSourceMessages.length})` : 'Переслать')}
                </button>
              ) : null}
              {selectedSavableMessages.length ? (
                <button type="button" onClick={() => handleBatchToggleSaveSelectedMessages(true)} disabled={forwardSubmitting || messageBatchActionLoading}>
                  {messageBatchActionLoading ? 'Сохраняю…' : selectedSavableMessages.length > 1 ? `Сохранить (${selectedSavableMessages.length})` : 'Сохранить'}
                </button>
              ) : null}
              {selectedUnsavableMessages.length ? (
                <button type="button" onClick={() => handleBatchToggleSaveSelectedMessages(false)} disabled={forwardSubmitting || messageBatchActionLoading}>
                  {messageBatchActionLoading ? 'Убираю…' : selectedUnsavableMessages.length > 1 ? `Убрать (${selectedUnsavableMessages.length})` : 'Убрать из сохранённых'}
                </button>
              ) : null}
              {selectedDeletableMessages.length ? (
                <button type="button" onClick={handleBatchDeleteSelectedMessages} disabled={forwardSubmitting || messageBatchActionLoading}>
                  {messageBatchActionLoading ? 'Удаляю…' : selectedDeletableMessages.length > 1 ? `Удалить (${selectedDeletableMessages.length})` : 'Удалить'}
                </button>
              ) : null}
              <button type="button" onClick={clearMessageSelection} disabled={forwardSubmitting || messageBatchActionLoading}>Отмена</button>
            </div>
          </div>
        ) : null}

        {replyingTo && composerMode !== 'edit' ? (
          <div className={`chatW-replyDraftBar ${replyDraftPulseKey ? 'is-pulsing' : ''}`.trim()} key={`reply-draft-${replyDraftPulseKey || 0}`}>
            <div className="chatW-replyDraftMain">
              <strong>Ответ на: {replyingTo.author}</strong>
              {replyDraftMeta.length ? (
                <div className="chatW-replyDraftMeta">
                  {replyDraftMeta.map((item) => <span key={item}>{item}</span>)}
                </div>
              ) : null}
              <span>{replyingTo.text}</span>
            </div>
            <button type="button" onClick={() => setReplyingTo(null)}>Отмена</button>
          </div>
        ) : null}

        <ChatOverlaySheets
          forwardSheetOpen={forwardSheetOpen}
          forwardSourceMessages={forwardSourceMessages}
          closeForwardSheet={closeForwardSheet}
          forwardTargetsQuery={forwardTargetsQuery}
          setForwardTargetsQuery={setForwardTargetsQuery}
          selectedMessage={selectedMessage}
          selectedMessageActionText={selectedMessageActionText}
          selectedMessagePreviewItems={selectedMessagePreviewItems}
          messageActionLoading={messageActionLoading}
          composerMode={composerMode}
          closeSelectedMessage={closeSelectedMessage}
          handleRetryMessage={handleRetryMessage}
          beginReplyMessage={beginReplyMessage}
          handleCopyMessage={handleCopyMessage}
          openForwardSheet={openForwardSheet}
          beginMultiMessageSelection={beginMultiMessageSelection}
          beginEditMessage={beginEditMessage}
          handleToggleSaveMessage={handleToggleSaveMessage}
          handleTogglePinMessage={handleTogglePinMessage}
          handleReportSelectedMessage={handleReportSelectedMessage}
          handleDeleteMessage={handleDeleteMessage}
          forwardTargetChats={forwardTargetChats}
          forwardSelectedChatIds={forwardSelectedChatIds}
          toggleForwardChatSelection={toggleForwardChatSelection}
          forwardComment={forwardComment}
          setForwardComment={setForwardComment}
          handleForwardSelectedMessage={handleForwardSelectedMessage}
          forwardSubmitting={forwardSubmitting}
          pinnedPanelOpen={pinnedPanelOpen}
          closePinnedPanel={closePinnedPanel}
          pinnedMessages={pinnedMessages}
          activePinnedEntry={activePinnedEntry}
          setPinnedCurrentIndex={setPinnedCurrentIndex}
          openPinnedMessage={openPinnedMessage}
          attachmentSheetOpen={attachmentSheetOpen}
          setAttachmentSheetOpen={setAttachmentSheetOpen}
          launchAttachmentPicker={launchAttachmentPicker}
          handleQuickReact={handleQuickReact}
          disableMessageActions={disableMessageActions}
          messageSelectionMode={messageSelectionMode}
          selectedMessages={selectedMessages}
        />

        {composerMode === 'edit' ? (
          <div className="chatW-editbar">
            <span>Редактирование сообщения</span>
            <button type="button" onClick={cancelComposerAction}>Отмена</button>
          </div>
        ) : null}

        {videoNoteState.phase !== 'idle' ? (
          <div className="chatW-videoDock" role="dialog" aria-label="Запись видеокружка">
            {(videoNoteState.phase === 'preview_live' || videoNoteState.phase === 'recording' || videoNoteState.phase === 'finalizing') ? (
              <div className="chatW-videoDock-card is-live">
                <button type="button" className="chatW-videoDock-iconBtn is-danger" onClick={closeVideoNoteRecorder} aria-label="Отменить видеокружок"><TrashIcon /></button>
                <div className="chatW-videoDock-core">
                  <div className="chatW-videoDock-circle">
                    <video ref={videoNoteLiveRef} autoPlay muted playsInline />
                    <div className="chatW-videoDock-circleShade" aria-hidden="true" />
                    {videoNoteState.phase === 'recording' ? <div className="chatW-videoDock-recBadge">REC</div> : null}
                  </div>
                  <div className="chatW-videoDock-topline">
                    <span className="chatW-videoDock-state">{videoNoteState.phase === 'recording' ? 'Идёт запись' : videoNoteState.phase === 'finalizing' ? 'Фиксируем' : 'Камера готова'}</span>
                    <strong>{formatVoiceDuration(videoNoteState.elapsedMs)}</strong>
                  </div>
                </div>
                {videoNoteState.phase === 'preview_live' ? (
                  <button type="button" className="chatW-videoDock-recordBtn" onClick={startVideoNoteRecording} aria-label="Начать запись видеокружка"><CameraIcon /></button>
                ) : videoNoteState.phase === 'finalizing' ? (
                  <div className="chatW-videoDock-spinnerWrap"><div className="chatW-videoDock-spinner" aria-hidden="true" /></div>
                ) : (
                  <button type="button" className="chatW-videoDock-recordBtn" onClick={stopVideoNoteRecording} aria-label="Остановить запись видеокружка"><StopRecordIcon /></button>
                )}
              </div>
            ) : null}

            {videoNoteState.phase === 'preview_result' ? (
              <div className="chatW-videoDock-card is-preview">
                <VideoNotePlayer
                  src={videoNoteState.url || ''}
                  direction="outgoing"
                  variant="preview"
                  className="chatW-videoNotePlayer-preview"
                />
                <div className="chatW-videoDock-actions">
                  <button type="button" className="chatW-videoDock-iconBtn" onClick={retakeVideoNote} aria-label="Переснять"><RefreshIcon /></button>
                  <button type="button" className="chatW-videoDock-iconBtn is-dangerSoft" onClick={closeVideoNoteRecorder} aria-label="Отменить"><TrashIcon /></button>
                  <button type="button" className="chatW-videoDock-primary" onClick={sendVideoNote}><SendIcon />Отправить</button>
                </div>
              </div>
            ) : null}

            {(videoNoteState.phase === 'permission' || videoNoteState.phase === 'error') ? (
              <div className="chatW-videoDock-card is-errorState">
                <div className="chatW-videoDock-errorCopy">
                  <strong className="chatW-videoDock-title">Не удалось открыть камеру</strong>
                  <div className="chatW-videoDock-subtitle">{videoNoteState.errorMessage || 'Не удалось получить доступ к камере и микрофону.'}</div>
                </div>
                <div className="chatW-videoDock-actions">
                  <button type="button" className="chatW-videoDock-secondary is-quiet" onClick={closeVideoNoteRecorder}>Закрыть</button>
                  {isDebugChat ? <button type="button" className="chatW-videoDock-secondary" onClick={() => runMediaProbe('av')}>Диагностика</button> : null}
                  <button type="button" className="chatW-videoDock-secondary" onClick={refreshMediaProbeDiagnostics}>Найти камеру</button>
                  <button type="button" className="chatW-videoDock-primary" onClick={openVideoNoteRecorder}>Повторить</button>
                </div>
              </div>
            ) : null}

            {(videoNoteState.phase === 'checking' || videoNoteState.phase === 'preparing' || videoNoteState.phase === 'sending') ? (
              <div className="chatW-videoDock-card is-loadingState">
                <div className="chatW-videoDock-stateRow">
                  <div className="chatW-videoDock-spinner" aria-hidden="true" />
                  <div>
                    <strong className="chatW-videoDock-title">{videoNoteState.phase === 'sending' ? 'Отправляем видеокружок' : 'Открываем камеру'}</strong>
                    <div className="chatW-videoDock-subtitle">{videoNoteState.phase === 'sending' ? 'Сообщение появится в переписке через мгновение.' : 'Подготавливаем видеокружок.'}</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {voiceRecorderState.phase !== 'idle' ? (
          <div className="chatW-voiceDock" role="dialog" aria-label="Запись голосового сообщения">
            {(voiceRecorderState.phase === 'recording' || voiceRecorderState.phase === 'finalizing') ? (
              <div className="chatW-voiceDock-card is-recording is-native">
                <button type="button" className="chatW-voiceDock-iconBtn is-danger" onClick={closeVoiceRecorder} aria-label="Отменить запись"><TrashIcon /></button>
                <div className="chatW-voiceDock-core">
                  <div className="chatW-voiceDock-topline">
                    <span className="chatW-voiceDock-state">{voiceRecorderState.phase === 'finalizing' ? 'Фиксируем' : 'Идёт запись'}</span>
                    <strong>{formatVoiceDuration(voiceRecorderState.elapsedMs)}</strong>
                  </div>
                  <LiveVoiceWave bars={20} />
                </div>
                {voiceRecorderState.phase === 'finalizing' ? (
                  <div className="chatW-voiceDock-spinnerWrap"><div className="chatW-voiceDock-spinner" aria-hidden="true" /></div>
                ) : (
                  <button type="button" className="chatW-voiceDock-recordBtn" onClick={stopVoiceRecording} aria-label="Остановить запись"><StopRecordIcon /></button>
                )}
              </div>
            ) : null}
            {voiceRecorderState.phase === 'preview' ? (
              <div className="chatW-voiceDock-card is-preview is-native">
                <VoiceMessagePlayer
                  src={voiceRecorderState.url || ''}
                  durationMs={voiceRecorderState.elapsedMs}
                  direction="outgoing"
                  variant="preview"
                  waveform={voiceRecorderState.waveform}
                  className="chatW-voicePlayer-preview"
                />
                <div className="chatW-voiceDock-actions is-inline is-premium">
                  <button type="button" className="chatW-voiceDock-iconBtn" onClick={retakeVoiceRecording} aria-label="Перезаписать"><RefreshIcon /></button>
                  <button type="button" className="chatW-voiceDock-iconBtn is-dangerSoft" onClick={closeVoiceRecorder} aria-label="Отменить"><TrashIcon /></button>
                  <button type="button" className="chatW-voiceDock-primary is-send" onClick={sendVoiceRecording}><SendIcon />Отправить</button>
                </div>
              </div>
            ) : null}
            {(voiceRecorderState.phase === 'permission' || voiceRecorderState.phase === 'error') ? (
              <div className="chatW-voiceDock-card is-errorState is-native">
                <div className="chatW-voiceDock-errorCopy">
                  <strong className="chatW-voiceDock-title">Не удалось начать запись</strong>
                  <div className="chatW-voiceDock-subtitle">{voiceRecorderState.errorMessage || 'Не удалось получить доступ к микрофону.'}</div>
                </div>
                <div className="chatW-voiceDock-actions is-inline">
                  <button type="button" className="chatW-voiceDock-secondary is-quiet" onClick={closeVoiceRecorder}>Закрыть</button>
                  {isDebugChat ? <button type="button" className="chatW-voiceDock-secondary" onClick={() => runMediaProbe('audio')}>Диагностика</button> : null}
                  <button type="button" className="chatW-voiceDock-primary is-send" onClick={openVoiceRecorder}>Повторить</button>
                </div>
              </div>
            ) : null}
            {(voiceRecorderState.phase === 'checking' || voiceRecorderState.phase === 'preparing' || voiceRecorderState.phase === 'sending') ? (
              <div className="chatW-voiceDock-card is-loadingState is-native">
                <div className="chatW-voiceDock-stateRow">
                  <div className="chatW-voiceDock-spinner" aria-hidden="true" />
                  <div>
                    <strong className="chatW-voiceDock-title">{voiceRecorderState.phase === 'sending' ? 'Отправляем голосовое' : 'Открываем микрофон'}</strong>
                    <div className="chatW-voiceDock-subtitle">{voiceRecorderState.phase === 'sending' ? 'Сообщение появится в переписке через мгновение.' : 'Подготавливаем запись.'}</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {isDebugChat && mediaProbeState.open ? (
          <div className="chatW-mediaprobe" role="dialog" aria-label="Диагностика микрофона и камеры">
            <div className="chatW-mediaprobe-head">
              <div>
                <div className="chatW-mediaprobe-title">Проверка устройств</div>
                <div className="chatW-mediaprobe-subtitle">Прямой тест доступа через браузер, без обходных сценариев интерфейса.</div>
              </div>
              <button type="button" className="chatW-mediaprobe-close" onClick={closeMediaProbe} aria-label="Закрыть">×</button>
            </div>
            <div className="chatW-mediaprobe-grid">
              <div className="chatW-mediaprobe-item"><span>Микрофоны</span><strong>{mediaProbeState.diagnostics?.audioInputCount ?? '—'}</strong></div>
              <div className="chatW-mediaprobe-item"><span>Камеры</span><strong>{mediaProbeState.diagnostics?.videoInputCount ?? '—'}</strong></div>
              <div className="chatW-mediaprobe-item"><span>Разрешение на микрофон</span><strong>{mediaPermissionLabel(mediaProbeState.diagnostics?.microphonePermission)}</strong></div>
              <div className="chatW-mediaprobe-item"><span>Разрешение на камеру</span><strong>{mediaPermissionLabel(mediaProbeState.diagnostics?.cameraPermission)}</strong></div>
            </div>
            <div className={`chatW-mediaprobe-result ${mediaProbeState.success ? 'is-success' : mediaProbeState.errorMessage ? 'is-error' : ''}`}>
              {mediaProbeState.loading ? (
                <span>Проверяем доступ к устройствам…</span>
              ) : mediaProbeState.success ? (
                <>
                  <strong>Доступ получен.</strong>
                  <span>{mediaProbeState.trackSummary}</span>
                </>
              ) : mediaProbeState.errorMessage ? (
                <>
                  <strong>{mediaProbeState.errorName || 'Ошибка доступа'}</strong>
                  <span>{mediaProbeState.errorMessage}</span>
                </>
              ) : (
                <span>Запусти одну из проверок ниже.</span>
              )}
            </div>
            <div className="chatW-mediaprobe-actions">
              <button type="button" className="chatW-voice-secondary" onClick={() => runMediaProbe('audio')} disabled={mediaProbeState.loading}>Проверить микрофон</button>
              <button type="button" className="chatW-voice-secondary" onClick={() => runMediaProbe('av')} disabled={mediaProbeState.loading}>Проверить камеру и микрофон</button>
              <button type="button" className="chatW-voice-secondary" onClick={refreshMediaProbeDiagnostics} disabled={mediaProbeState.loading}>Повторить поиск камеры</button>
              <button type="button" className="chatW-voice-primary" onClick={refreshMediaProbeDiagnostics} disabled={mediaProbeState.loading}>Обновить</button>
            </div>
          </div>
        ) : null}

        {composeBlockedByRequest && requestMeta ? (
          <div className={`chatW-composeBlockedCard is-${requestMeta.tone}`}>
            <strong>{requestMeta.composerTitle}</strong>
            <span>{requestMeta.composerText}</span>
            {requestCardActions}
          </div>
        ) : null}
        <div className="chatW-composer-topline">
          {isAttachmentUploading ? <span className="chatW-draft-indicator">Загружаем вложения…</span> : null}
          {!isAttachmentUploading && hasReadyAttachment ? <span className="chatW-draft-indicator">Готово к отправке: {readyAttachmentCount} {readyAttachmentCount === 1 ? 'вложение' : readyAttachmentCount < 5 ? 'вложения' : 'вложений'}</span> : null}
          {!isAttachmentUploading && hasFailedAttachment ? <span className="chatW-draft-indicator is-error">Часть вложений не загрузилась. Повторите или уберите их.</span> : null}
          {!hasPendingAttachments && draftState === 'saving' ? <span className="chatW-draft-indicator">Черновик сохраняется…</span> : null}
          {!hasPendingAttachments && draftState === 'saved' ? <span className="chatW-draft-indicator is-muted">Черновик сохранён</span> : null}
          {!hasPendingAttachments && draftState === 'error' ? <span className="chatW-draft-indicator is-error">Не удалось сохранить черновик</span> : null}
        </div>
        {hasPendingAttachments ? (
          <div className={`chatW-attachmentbar ${hasFailedAttachment ? 'is-error' : hasReadyAttachment ? 'is-ready' : ''}`}>
            <div className="chatW-attachmentbar-head">
              <strong>Вложения</strong>
              <span>{composerAttachments.length} шт.</span>
            </div>
            <div className="chatW-attachmentlist">
              {composerAttachments.map((attachment) => (
                <ComposerAttachmentCard
                  key={attachment.local_id || attachment.media?.url || attachment.original_name}
                  attachment={attachment}
                  uploadingAttachment={uploadingAttachment}
                  retryPendingAttachment={retryPendingAttachment}
                  clearPendingAttachment={clearPendingAttachment}
                />
              ))}
            </div>
          </div>
        ) : null}
        <div className="chatW-composer">
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleAttachmentChange} />
          <button className="chatW-icon-btn" type="button" aria-label="Прикрепить" aria-haspopup="dialog" aria-expanded={attachmentSheetOpen} onClick={openAttachmentPicker} disabled={composerMode === 'edit' || uploadingAttachment || composeBlockedByRequest}><AttachIcon /></button>
          <div className="chatW-composer-inputwrap">
            <input
              type="text"
              placeholder={composerPlaceholder}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !composeBlockedByRequest) handleSend(); }}
              disabled={composeBlockedByRequest}
            />
          </div>
          <div className="chatW-composer-actions">
            <button className="chatW-icon-btn chatW-icon-btn-accent" type="button" aria-label="Записать голосовое" title="Голосовое" onClick={openVoiceRecorder} disabled={composerMode === 'edit' || uploadingAttachment || composeBlockedByRequest}><MicIcon /></button>
            <button className="chatW-icon-btn chatW-icon-btn-accent" type="button" aria-label="Записать видеокружок" title={mediaDiagnostics && !hasDetectedCamera ? 'Камера не найдена' : 'Видеокружок'} onClick={openVideoNoteRecorder} disabled={composerMode === 'edit' || uploadingAttachment || composeBlockedByRequest}><CameraIcon /></button>
          </div>
          <button className="chatW-send-btn" type="button" aria-label="Отправить" onClick={handleSend} disabled={composerSendBlocked}>
            <SendIcon />
          </button>
        </div>
      </div>
    </section>
  );
}

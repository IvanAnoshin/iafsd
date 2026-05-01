import { useCallback, useEffect, useRef } from 'react';

function normalizeTelemetryEvent(event = {}) {
  if (!event || !event.category || !event.metric) return null;
  const normalized = {
    category: String(event.category).trim().toLowerCase(),
    metric: String(event.metric).trim().toLowerCase(),
    outcome: String(event.outcome || 'success').trim().toLowerCase() || 'success',
  };
  if (event.conversationId || event.conversation_id) normalized.conversationId = String(event.conversationId || event.conversation_id);
  if (event.callSessionId || event.call_session_id) normalized.callSessionId = String(event.callSessionId || event.call_session_id);
  if (Number.isFinite(Number(event.value))) normalized.value = Number(event.value);
  if (Number.isFinite(Number(event.durationMs ?? event.duration_ms))) {
    normalized.durationMs = Math.max(0, Math.round(Number(event.durationMs ?? event.duration_ms)));
  }
  if (event.details != null) normalized.details = event.details;
  return normalized;
}

export function useMessengerTelemetry() {
  const telemetryQueueRef = useRef([]);
  const telemetryFlushTimerRef = useRef(null);

  const flushMessengerTelemetry = useCallback((options = {}) => {
    const events = telemetryQueueRef.current.splice(0, telemetryQueueRef.current.length)
      .map((item) => normalizeTelemetryEvent(item))
      .filter(Boolean);
    if (!events.length || typeof window === 'undefined') return;

    const payload = JSON.stringify({ events });
    if (options.preferBeacon && navigator?.sendBeacon) {
      try {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/chat/telemetry', blob);
        return;
      } catch {}
    }

    fetch('/api/chat/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: Boolean(options.keepalive),
    }).catch(() => null);
  }, []);

  const emitMessengerTelemetry = useCallback((event) => {
    const normalized = normalizeTelemetryEvent(event);
    if (!normalized) return;
    telemetryQueueRef.current.push(normalized);
    if (telemetryQueueRef.current.length >= 8) {
      flushMessengerTelemetry();
      return;
    }
    if (telemetryFlushTimerRef.current || typeof window === 'undefined') return;
    telemetryFlushTimerRef.current = window.setTimeout(() => {
      telemetryFlushTimerRef.current = null;
      flushMessengerTelemetry();
    }, 1200);
  }, [flushMessengerTelemetry]);

  useEffect(() => () => {
    if (telemetryFlushTimerRef.current && typeof window !== 'undefined') {
      window.clearTimeout(telemetryFlushTimerRef.current);
      telemetryFlushTimerRef.current = null;
    }
    flushMessengerTelemetry({ preferBeacon: true, keepalive: true });
  }, [flushMessengerTelemetry]);

  return {
    emitMessengerTelemetry,
    flushMessengerTelemetry,
    telemetryQueueRef,
    telemetryFlushTimerRef,
  };
}

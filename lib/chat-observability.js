import prisma from '@/lib/prisma';

function hasMessengerMetrics(db = prisma) {
  return Boolean(db?.messengerMetricEvent);
}

function clampString(value, max = 64) {
  return String(value || '').trim().slice(0, max);
}

function sanitizeDetails(details) {
  if (details == null) return null;
  try {
    return JSON.parse(JSON.stringify(details));
  } catch {
    return null;
  }
}

function normalizeMetricInput(input = {}) {
  const category = clampString(input.category, 32).toLowerCase();
  const metric = clampString(input.metric, 64).toLowerCase();
  const outcome = clampString(input.outcome || 'success', 32).toLowerCase() || 'success';
  if (!category || !metric) return null;
  const value = Number.isFinite(Number(input.value)) ? Number(input.value) : null;
  const durationMs = Number.isFinite(Number(input.durationMs ?? input.duration_ms))
    ? Math.max(0, Math.round(Number(input.durationMs ?? input.duration_ms)))
    : null;
  return {
    userId: Number.isInteger(Number(input.userId)) && Number(input.userId) > 0 ? Number(input.userId) : null,
    conversationId: input.conversationId ? String(input.conversationId) : (input.conversation_id ? String(input.conversation_id) : null),
    callSessionId: input.callSessionId ? String(input.callSessionId) : (input.call_session_id ? String(input.call_session_id) : null),
    category,
    metric,
    outcome,
    value,
    durationMs,
    details: sanitizeDetails(input.details),
  };
}

export async function recordMessengerMetric(input, db = prisma) {
  if (!hasMessengerMetrics(db)) return null;
  const normalized = normalizeMetricInput(input);
  if (!normalized) return null;
  return db.messengerMetricEvent.create({ data: normalized });
}

export async function recordMessengerMetrics(items = [], db = prisma) {
  if (!hasMessengerMetrics(db)) return { count: 0 };
  const rows = (Array.isArray(items) ? items : [items]).map((item) => normalizeMetricInput(item)).filter(Boolean);
  if (!rows.length) return { count: 0 };
  const result = await db.messengerMetricEvent.createMany({ data: rows });
  return { count: Number(result?.count || rows.length) || 0 };
}

function hoursAgo(hours) {
  const date = new Date();
  date.setTime(date.getTime() - Math.max(1, Number(hours) || 1) * 60 * 60 * 1000);
  return date;
}

function buildRate(success, failure) {
  const total = Number(success || 0) + Number(failure || 0);
  if (!total) return 0;
  return Math.round((Number(success || 0) / total) * 1000) / 10;
}

export async function getMessengerObservabilityOverview(db = prisma) {
  if (!hasMessengerMetrics(db)) return null;
  const last24h = hoursAgo(24);
  const where24h = { createdAt: { gte: last24h } };

  const [
    messageSendSuccess24h,
    messageSendError24h,
    messageSendAvgMs24h,
    mediaUploadSuccess24h,
    mediaUploadError24h,
    mediaUploadAvgMs24h,
    mediaUploadAvgBytes24h,
    reconnectAttempts24h,
    reconnectRecovered24h,
    reconnectResetRequired24h,
    callCreateSuccess24h,
    callCreateError24h,
    callRecoverySuccess24h,
    callRecoveryError24h,
    mediaDeviceErrors24h,
    chatOpenAvgMs24h,
    recentFailures,
  ] = await Promise.all([
    db.messengerMetricEvent.count({ where: { ...where24h, category: 'message', metric: 'send', outcome: 'success' } }),
    db.messengerMetricEvent.count({ where: { ...where24h, category: 'message', metric: 'send', outcome: 'error' } }),
    db.messengerMetricEvent.aggregate({ where: { ...where24h, category: 'message', metric: 'send', outcome: 'success' }, _avg: { durationMs: true } }),
    db.messengerMetricEvent.count({ where: { ...where24h, category: 'media', metric: 'upload', outcome: 'success' } }),
    db.messengerMetricEvent.count({ where: { ...where24h, category: 'media', metric: 'upload', outcome: 'error' } }),
    db.messengerMetricEvent.aggregate({ where: { ...where24h, category: 'media', metric: 'upload', outcome: 'success' }, _avg: { durationMs: true } }),
    db.messengerMetricEvent.aggregate({ where: { ...where24h, category: 'media', metric: 'upload', outcome: 'success' }, _avg: { value: true } }),
    db.messengerMetricEvent.count({ where: { ...where24h, category: 'realtime', metric: 'reconnect', outcome: 'attempt' } }),
    db.messengerMetricEvent.count({ where: { ...where24h, category: 'realtime', metric: 'reconnect', outcome: 'recovered' } }),
    db.messengerMetricEvent.count({ where: { ...where24h, category: 'realtime', metric: 'reconnect', outcome: 'reset_required' } }),
    db.messengerMetricEvent.count({ where: { ...where24h, category: 'call', metric: 'create', outcome: 'success' } }),
    db.messengerMetricEvent.count({ where: { ...where24h, category: 'call', metric: 'create', outcome: 'error' } }),
    db.messengerMetricEvent.count({ where: { ...where24h, category: 'call', metric: 'recovery', outcome: 'success' } }),
    db.messengerMetricEvent.count({ where: { ...where24h, category: 'call', metric: 'recovery', outcome: 'error' } }),
    db.messengerMetricEvent.count({ where: { ...where24h, category: 'call', metric: 'media_device', outcome: 'error' } }),
    db.messengerMetricEvent.aggregate({ where: { ...where24h, category: 'chat', metric: 'open', outcome: 'success' }, _avg: { durationMs: true } }),
    db.messengerMetricEvent.findMany({
      where: { ...where24h, outcome: 'error' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, category: true, metric: true, outcome: true, details: true, createdAt: true },
    }),
  ]);

  return {
    window: '24h',
    messages: {
      send_success_24h: messageSendSuccess24h,
      send_error_24h: messageSendError24h,
      send_success_rate_24h: buildRate(messageSendSuccess24h, messageSendError24h),
      send_avg_ms_24h: Math.round(Number(messageSendAvgMs24h?._avg?.durationMs || 0)),
    },
    media: {
      upload_success_24h: mediaUploadSuccess24h,
      upload_error_24h: mediaUploadError24h,
      upload_success_rate_24h: buildRate(mediaUploadSuccess24h, mediaUploadError24h),
      upload_avg_ms_24h: Math.round(Number(mediaUploadAvgMs24h?._avg?.durationMs || 0)),
      upload_avg_bytes_24h: Math.round(Number(mediaUploadAvgBytes24h?._avg?.value || 0)),
    },
    realtime: {
      reconnect_attempts_24h: reconnectAttempts24h,
      reconnect_recovered_24h: reconnectRecovered24h,
      reconnect_reset_required_24h: reconnectResetRequired24h,
      reconnect_recovery_rate_24h: buildRate(reconnectRecovered24h, Math.max(0, reconnectAttempts24h - reconnectRecovered24h)),
    },
    calls: {
      create_success_24h: callCreateSuccess24h,
      create_error_24h: callCreateError24h,
      create_success_rate_24h: buildRate(callCreateSuccess24h, callCreateError24h),
      recovery_success_24h: callRecoverySuccess24h,
      recovery_error_24h: callRecoveryError24h,
      media_device_errors_24h: mediaDeviceErrors24h,
    },
    ux: {
      chat_open_avg_ms_24h: Math.round(Number(chatOpenAvgMs24h?._avg?.durationMs || 0)),
    },
    recent_failures: recentFailures.map((item) => ({
      id: item.id,
      category: item.category,
      metric: item.metric,
      outcome: item.outcome,
      details: item.details || null,
      created_at: item.createdAt,
    })),
  };
}

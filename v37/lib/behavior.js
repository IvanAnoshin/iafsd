import prisma from '@/lib/prisma';
import { computeDfsnFeatures, mergeBehavioralProfile } from '@/lib/dfsn';
import { ensureUserDevice } from '@/lib/devices';

function asArray(value, limit = 700) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function asDate(value, fallback = new Date()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function asNullableInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function sanitizeText(value, fallback, max = 120) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : fallback;
}

export function normalizeBehaviorPayload(payload = {}) {
  const startedAt = asDate(payload.started_at || payload.startedAt || new Date());
  const endedAt = asDate(payload.ended_at || payload.endedAt || new Date(), new Date());
  return {
    route: sanitizeText(payload.route, '/'),
    screen: sanitizeText(payload.screen, 'unknown'),
    timezone: payload.timezone ? sanitizeText(payload.timezone, null, 100) : null,
    locale: payload.locale ? sanitizeText(payload.locale, null, 40) : null,
    sessionHour: asNullableInt(payload.session_hour ?? payload.sessionHour),
    sessionWeekday: asNullableInt(payload.session_weekday ?? payload.sessionWeekday),
    newDeviceFlag: Boolean(payload.new_device_flag ?? payload.newDeviceFlag),
    newNetworkFlag: Boolean(payload.new_network_flag ?? payload.newNetworkFlag),
    newGeoFlag: Boolean(payload.new_geo_flag ?? payload.newGeoFlag),
    typingEvents: asArray(payload.typing_events ?? payload.typingEvents, 1200),
    mouseEvents: asArray(payload.mouse_events ?? payload.mouseEvents, 1200),
    scrollEvents: asArray(payload.scroll_events ?? payload.scrollEvents, 600),
    deviceContext: payload.device_context && typeof payload.device_context === 'object' ? payload.device_context : {},
    startedAt,
    endedAt: endedAt < startedAt ? new Date(startedAt.getTime() + 1000) : endedAt,
  };
}

function buildDfsnRecord({ userId, normalized, features, labelSource = 'behavior_update', batchId = null }) {
  return {
    userId,
    phase: 'behavior',
    route: normalized.route,
    screen: normalized.screen,
    authOutcome: 'behavior_update',
    trustLabel: 'trusted',
    labelSource,
    isPassive: true,
    timezone: normalized.timezone,
    locale: normalized.locale,
    sessionHour: normalized.sessionHour,
    sessionWeekday: normalized.sessionWeekday,
    newDeviceFlag: normalized.newDeviceFlag,
    newNetworkFlag: normalized.newNetworkFlag,
    newGeoFlag: normalized.newGeoFlag,
    typingEvents: normalized.typingEvents,
    mouseEvents: normalized.mouseEvents,
    scrollEvents: normalized.scrollEvents,
    typingSpeed: features.typingSpeed,
    typingVariance: features.typingVariance,
    correctionRate: features.correctionRate,
    mouseSpeed: features.mouseSpeed,
    mouseAccuracy: features.mouseAccuracy,
    hoverLatency: features.hoverLatency,
    scrollDepth: features.scrollDepth,
    scrollSpeed: features.scrollSpeed,
    sessionDuration: features.sessionDuration,
    activeHours: features.activeHours,
    pattern: features.pattern,
    qualityFlags: features.qualityFlags,
    summaries: {
      ...features.summaries,
      label_source: labelSource,
      passive_collection: true,
      batch_id: batchId,
    },
    startedAt: normalized.startedAt,
    endedAt: normalized.endedAt,
  };
}

export async function recordBehaviorUpdate({ user, request, payload, tx = prisma }) {
  const normalized = normalizeBehaviorPayload(payload);
  const features = computeDfsnFeatures({
    typingEvents: normalized.typingEvents,
    mouseEvents: normalized.mouseEvents,
    scrollEvents: normalized.scrollEvents,
    startedAt: normalized.startedAt,
    endedAt: normalized.endedAt,
    route: normalized.route,
    screen: normalized.screen,
  });

  const nextProfile = mergeBehavioralProfile(user.behavioralProfile, features);

  const result = await tx.$transaction(async (trx) => {
    const dfsnSession = await trx.dfsnSession.create({
      data: buildDfsnRecord({ userId: user.id, normalized, features }),
    });

    await trx.user.update({
      where: { id: user.id },
      data: {
        behavioralProfile: nextProfile,
        behavioralTrustLabel: 'trusted',
        behavioralUpdatedAt: normalized.endedAt,
      },
    });

    await ensureUserDevice({ userId: user.id, request, deviceContext: normalized.deviceContext, tx: trx });

    return dfsnSession;
  });

  return {
    sessionId: result.id,
    trustLabel: 'trusted',
    qualityFlags: features.qualityFlags,
    summary: {
      typing_speed: features.typingSpeed,
      typing_variance: features.typingVariance,
      correction_rate: features.correctionRate,
      mouse_speed: features.mouseSpeed,
      mouse_accuracy: features.mouseAccuracy,
      hover_latency: features.hoverLatency,
      scroll_depth: features.scrollDepth,
      scroll_speed: features.scrollSpeed,
      session_duration: features.sessionDuration,
    },
  };
}

export async function recordBehaviorBatch({ user, request, items, tx = prisma }) {
  const normalizedItems = (Array.isArray(items) ? items : []).slice(0, 20).map(normalizeBehaviorPayload);
  if (!normalizedItems.length) {
    const error = new Error('Передай хотя бы одну запись поведения.');
    error.status = 400;
    throw error;
  }

  let currentProfile = user.behavioralProfile;
  const batchId = `batch:${Date.now()}:${user.id}`;
  const createdSessions = [];
  const qualityFlags = new Set();

  await tx.$transaction(async (trx) => {
    for (const normalized of normalizedItems) {
      const features = computeDfsnFeatures({
        typingEvents: normalized.typingEvents,
        mouseEvents: normalized.mouseEvents,
        scrollEvents: normalized.scrollEvents,
        startedAt: normalized.startedAt,
        endedAt: normalized.endedAt,
        route: normalized.route,
        screen: normalized.screen,
      });

      currentProfile = mergeBehavioralProfile(currentProfile, features);
      features.qualityFlags.forEach((flag) => qualityFlags.add(flag));

      const dfsnSession = await trx.dfsnSession.create({
        data: buildDfsnRecord({ userId: user.id, normalized, features, labelSource: 'behavior_batch', batchId }),
      });

      createdSessions.push(dfsnSession.id);
    }

    await trx.user.update({
      where: { id: user.id },
      data: {
        behavioralProfile: currentProfile,
        behavioralTrustLabel: 'trusted',
        behavioralUpdatedAt: normalizedItems[normalizedItems.length - 1].endedAt,
      },
    });

    await ensureUserDevice({
      userId: user.id,
      request,
      deviceContext: normalizedItems[0]?.deviceContext || {},
      tx: trx,
    });
  });

  return {
    createdCount: createdSessions.length,
    sessionIds: createdSessions,
    trustLabel: 'trusted',
    qualityFlags: [...qualityFlags],
  };
}

import crypto from 'node:crypto';
import prisma from '@/lib/prisma';

const DEFAULT_LIMIT = 60;
const DEFAULT_WINDOW_SEC = 60;
const MAX_SUBJECT_LENGTH = 220;

const POLICY_PRESETS = {
  auth_login: { limit: 8, windowSec: 15 * 60, blockSec: 15 * 60, severity: 'high' },
  auth_register: { limit: 4, windowSec: 60 * 60, blockSec: 60 * 60, severity: 'high' },
  auth_recovery: { limit: 5, windowSec: 30 * 60, blockSec: 30 * 60, severity: 'high' },
  auth_passkey_options: { limit: 12, windowSec: 15 * 60, blockSec: 15 * 60, severity: 'medium' },
  auth_passkey_verify: { limit: 12, windowSec: 15 * 60, blockSec: 15 * 60, severity: 'high' },
  auth_passkey_register: { limit: 8, windowSec: 60 * 60, blockSec: 30 * 60, severity: 'medium' },
  auth_recovery_complete: { limit: 8, windowSec: 30 * 60, blockSec: 30 * 60, severity: 'high' },

  admin_read: { limit: 240, windowSec: 15 * 60, blockSec: 10 * 60, severity: 'medium' },
  admin_write: { limit: 80, windowSec: 15 * 60, blockSec: 15 * 60, severity: 'high' },
  admin_export: { limit: 8, windowSec: 60 * 60, blockSec: 60 * 60, severity: 'high' },
  device_sensitive: { limit: 12, windowSec: 30 * 60, blockSec: 20 * 60, severity: 'high' },

  post_create: { limit: 20, windowSec: 10 * 60, blockSec: 10 * 60, severity: 'medium' },
  comment_create: { limit: 40, windowSec: 10 * 60, blockSec: 10 * 60, severity: 'medium' },
  chat_message_send: { limit: 90, windowSec: 60, blockSec: 5 * 60, severity: 'medium' },
  chat_media_upload: { limit: 40, windowSec: 60 * 60, blockSec: 15 * 60, severity: 'medium' },
  profile_media_upload: { limit: 40, windowSec: 60 * 60, blockSec: 15 * 60, severity: 'medium' },
  story_create: { limit: 20, windowSec: 24 * 60 * 60, blockSec: 60 * 60, severity: 'medium' },
  story_media_upload: { limit: 30, windowSec: 60 * 60, blockSec: 15 * 60, severity: 'medium' },

  community_create: { limit: 3, windowSec: 24 * 60 * 60, blockSec: 2 * 60 * 60, severity: 'high' },
  community_join: { limit: 30, windowSec: 24 * 60 * 60, blockSec: 60 * 60, severity: 'medium' },
  community_post_create: { limit: 30, windowSec: 60 * 60, blockSec: 20 * 60, severity: 'medium' },
  community_invite_create: { limit: 40, windowSec: 24 * 60 * 60, blockSec: 60 * 60, severity: 'medium' },
  community_invite_check: { limit: 25, windowSec: 60 * 60, blockSec: 30 * 60, severity: 'medium' },
  community_media_upload: { limit: 40, windowSec: 60 * 60, blockSec: 15 * 60, severity: 'medium' },

  friend_request: { limit: 30, windowSec: 24 * 60 * 60, blockSec: 60 * 60, severity: 'medium' },
  report_create: { limit: 50, windowSec: 24 * 60 * 60, blockSec: 60 * 60, severity: 'medium' },
  support_ticket_create: { limit: 5, windowSec: 24 * 60 * 60, blockSec: 2 * 60 * 60, severity: 'medium' },
  account_data_export: { limit: 5, windowSec: 24 * 60 * 60, blockSec: 60 * 60, severity: 'high' },
  account_deletion_action: { limit: 8, windowSec: 24 * 60 * 60, blockSec: 60 * 60, severity: 'high' },
  post_share: { limit: 30, windowSec: 60 * 60, blockSec: 20 * 60, severity: 'medium' },
};

const memoryBuckets = globalThis.__friendscapeRateLimitBuckets || new Map();
globalThis.__friendscapeRateLimitBuckets = memoryBuckets;

function clampText(value, max = MAX_SUBJECT_LENGTH) {
  return String(value || '').trim().slice(0, max) || 'unknown';
}

export function getClientIp(request) {
  return request?.headers?.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request?.headers?.get('x-real-ip')
    || request?.headers?.get('cf-connecting-ip')
    || 'unknown-ip';
}

function getRequestRoute(request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return null;
  }
}

function getPolicy(policy) {
  return POLICY_PRESETS[policy] || { limit: DEFAULT_LIMIT, windowSec: DEFAULT_WINDOW_SEC, blockSec: 0, severity: 'low' };
}

function hashKey(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function envBool(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function buildSubject({ request, actorUserId, subject }) {
  if (subject) return clampText(subject);
  if (actorUserId) return `user:${actorUserId}`;
  return `ip:${getClientIp(request)}`;
}

function buildRateLimitResponse(result) {
  const retryAfter = Math.max(1, Math.ceil((result.retryAt.getTime() - Date.now()) / 1000));
  return Response.json(
    {
      error: 'Слишком много действий. Попробуйте чуть позже.',
      code: 'RATE_LIMITED',
      retry_after: retryAfter,
      policy: result.policy,
    },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(result.retryAt.getTime() / 1000)),
      },
    }
  );
}

function buildRateLimitStorageUnavailableResponse(policyName) {
  return Response.json(
    {
      error: 'Система защиты от злоупотреблений временно недоступна. Попробуйте позже.',
      code: 'RATE_LIMIT_STORAGE_UNAVAILABLE',
      policy: policyName,
    },
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': '60',
      },
    }
  );
}

function memoryConsume({ key, policyName, subject, actorUserId, request, preset }) {
  const now = Date.now();
  const existing = memoryBuckets.get(key);
  const resetAtMs = existing && existing.resetAtMs > now ? existing.resetAtMs : now + preset.windowSec * 1000;
  const blockedUntilMs = existing?.blockedUntilMs || 0;

  if (blockedUntilMs > now) {
    return { ok: false, policy: policyName, limit: preset.limit, remaining: 0, retryAt: new Date(blockedUntilMs), source: 'memory' };
  }

  const count = existing && existing.resetAtMs > now ? existing.count : 0;
  if (count >= preset.limit) {
    const blocked = preset.blockSec ? now + preset.blockSec * 1000 : resetAtMs;
    memoryBuckets.set(key, { count, resetAtMs, blockedUntilMs: blocked, policyName, subject, actorUserId, route: getRequestRoute(request) });
    return { ok: false, policy: policyName, limit: preset.limit, remaining: 0, retryAt: new Date(blocked), source: 'memory' };
  }

  const nextCount = count + 1;
  memoryBuckets.set(key, { count: nextCount, resetAtMs, blockedUntilMs: 0, policyName, subject, actorUserId, route: getRequestRoute(request) });
  return { ok: true, policy: policyName, limit: preset.limit, remaining: Math.max(0, preset.limit - nextCount), resetAt: new Date(resetAtMs), source: 'memory' };
}

async function recordAbuseEvent({ request, policyName, subject, actorUserId, preset, retryAfter, metadata }) {
  try {
    if (!prisma.abuseEvent) return;
    await prisma.abuseEvent.create({
      data: {
        policy: policyName,
        subject,
        actorUserId: actorUserId || null,
        route: getRequestRoute(request),
        method: String(request?.method || '').toUpperCase() || null,
        status: 'limited',
        severity: preset.severity || 'medium',
        retryAfter: retryAfter || null,
        metadata: metadata || null,
      },
    });
  } catch (error) {
    console.error('abuse event write failed', error?.message || error);
  }
}

async function dbConsume({ key, policyName, subject, actorUserId, request, preset }) {
  if (!prisma.rateLimitBucket) {
    throw new Error('RateLimitBucket model is unavailable. Run prisma generate after updating schema.');
  }

  const now = new Date();
  const route = getRequestRoute(request);
  const existing = await prisma.rateLimitBucket.findUnique({ where: { key } });

  if (!existing || existing.resetAt <= now) {
    const resetAt = new Date(now.getTime() + preset.windowSec * 1000);
    await prisma.rateLimitBucket.upsert({
      where: { key },
      create: { key, policy: policyName, subject, count: 1, resetAt, blockedUntil: null, actorUserId: actorUserId || null, route },
      update: { policy: policyName, subject, count: 1, resetAt, blockedUntil: null, actorUserId: actorUserId || null, route },
    });
    return { ok: true, policy: policyName, limit: preset.limit, remaining: Math.max(0, preset.limit - 1), resetAt, source: 'db' };
  }

  if (existing.blockedUntil && existing.blockedUntil > now) {
    return { ok: false, policy: policyName, limit: preset.limit, remaining: 0, retryAt: existing.blockedUntil, source: 'db' };
  }

  if (existing.count >= preset.limit) {
    const blockedUntil = preset.blockSec ? new Date(now.getTime() + preset.blockSec * 1000) : existing.resetAt;
    await prisma.rateLimitBucket.update({
      where: { key },
      data: { blockedUntil, route, actorUserId: actorUserId || null },
    }).catch(() => null);
    return { ok: false, policy: policyName, limit: preset.limit, remaining: 0, retryAt: blockedUntil, source: 'db' };
  }

  const updated = await prisma.rateLimitBucket.update({
    where: { key },
    data: { count: { increment: 1 }, route, actorUserId: actorUserId || null },
  });

  return {
    ok: true,
    policy: policyName,
    limit: preset.limit,
    remaining: Math.max(0, preset.limit - updated.count),
    resetAt: updated.resetAt,
    source: 'db',
  };
}

export async function consumeRateLimit({ request, policy, actorUserId = null, subject = '', metadata = null } = {}) {
  const policyName = String(policy || 'default').trim();
  const preset = getPolicy(policyName);
  const resolvedSubject = buildSubject({ request, actorUserId, subject });
  const key = `${policyName}:${hashKey(resolvedSubject)}`;

  let result;
  try {
    result = await dbConsume({ key, policyName, subject: resolvedSubject, actorUserId, request, preset });
  } catch (error) {
    const allowProductionFallback = envBool('RATE_LIMIT_MEMORY_FALLBACK_IN_PRODUCTION', false);
    const isProduction = process.env.NODE_ENV === 'production';
    if (process.env.NODE_ENV !== 'test') {
      console.warn('rate limit db fallback', { policy: policyName, message: error?.message || String(error), allowed: !isProduction || allowProductionFallback });
    }
    if (isProduction && !allowProductionFallback) {
      return {
        ok: false,
        policy: policyName,
        limit: preset.limit,
        remaining: 0,
        retryAt: new Date(Date.now() + 60_000),
        source: 'unavailable',
        response: buildRateLimitStorageUnavailableResponse(policyName),
      };
    }
    result = memoryConsume({ key, policyName, subject: resolvedSubject, actorUserId, request, preset });
  }

  if (!result.ok) {
    const retryAfter = Math.max(1, Math.ceil((result.retryAt.getTime() - Date.now()) / 1000));
    await recordAbuseEvent({ request, policyName, subject: resolvedSubject, actorUserId, preset, retryAfter, metadata }).catch(() => null);
    return { ...result, response: buildRateLimitResponse(result) };
  }

  return result;
}

export async function enforceRateLimit(options) {
  const result = await consumeRateLimit(options);
  return result.ok ? null : result.response;
}

export async function cleanupRateLimitBuckets({ olderThanHours = 48 } = {}) {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  if (!prisma.rateLimitBucket) return { deleted: 0 };
  const result = await prisma.rateLimitBucket.deleteMany({
    where: {
      resetAt: { lt: cutoff },
      OR: [{ blockedUntil: null }, { blockedUntil: { lt: cutoff } }],
    },
  });
  return { deleted: result.count || 0 };
}

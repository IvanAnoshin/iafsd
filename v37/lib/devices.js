import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 8;
const DEVICE_TRUST_AFTER_SESSIONS = Math.max(1, Number(process.env.DEVICE_TRUST_AFTER_SESSIONS || 3));

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sanitizeString(value, max = 200) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeDeviceContext(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    platform: sanitizeString(source.platform, 80),
    screen_width: toFiniteNumber(source.screen_width),
    screen_height: toFiniteNumber(source.screen_height),
    hardware_concurrency: toFiniteNumber(source.hardware_concurrency),
    device_memory: toFiniteNumber(source.device_memory),
    touch_points: toFiniteNumber(source.touch_points),
    color_depth: toFiniteNumber(source.color_depth),
    timezone: sanitizeString(source.timezone, 100),
    locale: sanitizeString(source.locale, 40),
    device_name: sanitizeString(source.device_name, 120),
  };
}

function inferPlatform(userAgent, deviceContext) {
  const explicit = sanitizeString(deviceContext.platform, 80);
  if (explicit) return explicit;

  const ua = String(userAgent || '').toLowerCase();
  if (!ua) return 'unknown';
  if (ua.includes('iphone')) return 'iphone';
  if (ua.includes('ipad')) return 'ipad';
  if (ua.includes('android')) return 'android';
  if (ua.includes('macintosh') || ua.includes('mac os')) return 'mac';
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

function buildDeviceLabel(platform, userAgent, deviceContext) {
  if (deviceContext.device_name) return deviceContext.device_name;

  switch (platform) {
    case 'iphone':
      return 'iPhone';
    case 'ipad':
      return 'iPad';
    case 'android':
      return 'Android';
    case 'mac':
      return 'Mac';
    case 'windows':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      break;
  }

  const ua = String(userAgent || '');
  if (ua) return 'Устройство браузера';
  return 'Неизвестное устройство';
}

export function deriveDeviceDescriptor({ request, deviceContext = {} }) {
  const normalized = normalizeDeviceContext(deviceContext);
  const userAgent = request?.headers?.get('user-agent') || null;
  const acceptLanguage = request?.headers?.get('accept-language') || null;
  const platform = inferPlatform(userAgent, normalized);
  const label = buildDeviceLabel(platform, userAgent, normalized);
  const ipAddress = request?.headers?.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request?.headers?.get('x-real-ip')
    || null;

  const rawFingerprint = JSON.stringify({
    userAgent,
    acceptLanguage,
    platform,
    screenWidth: normalized.screen_width,
    screenHeight: normalized.screen_height,
    hardwareConcurrency: normalized.hardware_concurrency,
    deviceMemory: normalized.device_memory,
    touchPoints: normalized.touch_points,
    colorDepth: normalized.color_depth,
    timezone: normalized.timezone,
    locale: normalized.locale,
  });

  return {
    fingerprint: sha256(rawFingerprint),
    label,
    platform,
    userAgent,
    ipAddress,
    metadata: normalized,
  };
}

export async function ensureUserDevice({ userId, request, deviceContext = {}, tx = prisma }) {
  const descriptor = deriveDeviceDescriptor({ request, deviceContext });
  const sessionCount = await tx.session.count({
    where: {
      userId,
      deviceFingerprint: descriptor.fingerprint,
    },
  });

  const existing = await tx.userDevice.findUnique({
    where: {
      userId_fingerprint: {
        userId,
        fingerprint: descriptor.fingerprint,
      },
    },
  });

  const observedSessionCount = Math.max(
    sessionCount,
    Number(existing?.metadata?.observed_session_count) || 0,
  );

  const nextMetadata = {
    ...(existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata) ? existing.metadata : {}),
    ...(descriptor.metadata && typeof descriptor.metadata === 'object' && !Array.isArray(descriptor.metadata) ? descriptor.metadata : {}),
    observed_session_count: observedSessionCount,
    trust_after_sessions: DEVICE_TRUST_AFTER_SESSIONS,
  };

  const shouldTrust = observedSessionCount >= DEVICE_TRUST_AFTER_SESSIONS || Boolean(existing?.trusted);
  const now = new Date();

  const device = existing
    ? await tx.userDevice.update({
        where: { id: existing.id },
        data: {
          label: descriptor.label,
          platform: descriptor.platform,
          userAgent: descriptor.userAgent,
          lastSeenAt: now,
          lastIpAddress: descriptor.ipAddress,
          metadata: nextMetadata,
          trusted: shouldTrust,
        },
      })
    : await tx.userDevice.create({
        data: {
          userId,
          fingerprint: descriptor.fingerprint,
          label: descriptor.label,
          platform: descriptor.platform,
          userAgent: descriptor.userAgent,
          lastSeenAt: now,
          lastIpAddress: descriptor.ipAddress,
          metadata: nextMetadata,
          trusted: shouldTrust,
        },
      });

  return { device: shouldTrust ? device : null, descriptor, sessionCount: observedSessionCount, trusted: shouldTrust };
}

export async function attachSessionToDevice({ sessionId, userId, request, deviceContext = {}, tx = prisma }) {
  const descriptor = deriveDeviceDescriptor({ request, deviceContext });
  await tx.session.update({
    where: { id: sessionId },
    data: {
      deviceFingerprint: descriptor.fingerprint,
      deviceLabel: descriptor.label,
    },
  }).catch(() => {});

  const result = await ensureUserDevice({ userId, request, deviceContext, tx });
  return { device: result.device, descriptor, trusted: result.trusted, sessionCount: result.sessionCount };
}

export async function touchDeviceForSession(sessionId, tx = prisma) {
  const session = await tx.session.findUnique({
    where: { id: sessionId },
    select: {
      userId: true,
      deviceFingerprint: true,
      lastSeenAt: true,
    },
  });

  if (!session?.deviceFingerprint) return null;

  return tx.userDevice.updateMany({
    where: {
      userId: session.userId,
      fingerprint: session.deviceFingerprint,
    },
    data: {
      lastSeenAt: session.lastSeenAt || new Date(),
    },
  }).catch(() => null);
}

function serializeDevice(device, { currentFingerprint = null, sessionCount = 0 } = {}) {
  return {
    id: device.id,
    label: device.label,
    platform: device.platform,
    user_agent: device.userAgent,
    trusted: Boolean(device.trusted),
    has_pin: Boolean(device.pinHash),
    last_seen_at: device.lastSeenAt,
    last_ip_address: device.lastIpAddress,
    created_at: device.createdAt,
    updated_at: device.updatedAt,
    session_count: sessionCount,
    is_current: currentFingerprint ? device.fingerprint === currentFingerprint : false,
    metadata: device.metadata || null,
  };
}

export async function listUserDevices(userId, currentSession = null, tx = prisma) {
  const devices = await tx.userDevice.findMany({
    where: { userId, trusted: true },
    orderBy: [{ lastSeenAt: 'desc' }, { createdAt: 'desc' }],
  });

  const fingerprints = devices.map((item) => item.fingerprint).filter(Boolean);
  let sessionCounts = new Map();

  if (fingerprints.length) {
    const activeSessions = await tx.session.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() },
        deviceFingerprint: { in: fingerprints },
      },
      select: { deviceFingerprint: true },
    });

    sessionCounts = activeSessions.reduce((map, item) => {
      const key = item.deviceFingerprint;
      if (!key) return map;
      map.set(key, (map.get(key) || 0) + 1);
      return map;
    }, new Map());
  }

  return devices.map((item) => serializeDevice(item, {
    currentFingerprint: currentSession?.deviceFingerprint || null,
    sessionCount: sessionCounts.get(item.fingerprint) || 0,
  }));
}

export async function getUserDevice(userId, deviceId, currentSession = null, tx = prisma) {
  const device = await tx.userDevice.findFirst({
    where: { id: deviceId, userId, trusted: true },
  });
  if (!device) return null;

  const sessionCount = await tx.session.count({
    where: {
      userId,
      expiresAt: { gt: new Date() },
      deviceFingerprint: device.fingerprint,
    },
  });

  return serializeDevice(device, {
    currentFingerprint: currentSession?.deviceFingerprint || null,
    sessionCount,
  });
}

export function validateDevicePin(pin) {
  const value = String(pin || '').trim();
  if (!/^\d+$/.test(value)) {
    return { ok: false, error: 'PIN должен состоять только из цифр.' };
  }
  if (value.length < PIN_MIN_LENGTH || value.length > PIN_MAX_LENGTH) {
    return { ok: false, error: `PIN должен содержать от ${PIN_MIN_LENGTH} до ${PIN_MAX_LENGTH} цифр.` };
  }
  return { ok: true, value };
}

export async function updateUserDevicePin(userId, deviceId, pin, tx = prisma) {
  const validation = validateDevicePin(pin);
  if (!validation.ok) {
    const error = new Error(validation.error);
    error.status = 400;
    throw error;
  }

  const device = await tx.userDevice.findFirst({ where: { id: deviceId, userId, trusted: true } });
  if (!device) {
    const error = new Error('Устройство не найдено.');
    error.status = 404;
    throw error;
  }

  const pinHash = await bcrypt.hash(validation.value, 10);

  await tx.userDevice.update({
    where: { id: device.id },
    data: { pinHash },
  });

  return true;
}

export async function deleteUserDevice(userId, deviceId, tx = prisma) {
  const device = await tx.userDevice.findFirst({ where: { id: deviceId, userId, trusted: true } });
  if (!device) {
    const error = new Error('Устройство не найдено.');
    error.status = 404;
    throw error;
  }

  await tx.$transaction(async (trx) => {
    await trx.session.deleteMany({
      where: {
        userId,
        deviceFingerprint: device.fingerprint,
      },
    });
    await trx.userDevice.delete({ where: { id: device.id } });
  });

  return { id: device.id, label: device.label, fingerprint: device.fingerprint };
}

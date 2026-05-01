import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import { attachSessionToDevice, touchDeviceForSession } from '@/lib/devices';

export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || 'fs_session';
export const CSRF_COOKIE = process.env.CSRF_COOKIE_NAME || 'fs_csrf';
const SESSION_TTL_DAYS = 30;
const ALLOWED_SAME_SITE = new Set(['strict', 'lax', 'none']);

function getCookieSameSite() {
  const raw = String(process.env.SESSION_COOKIE_SAME_SITE || 'lax').toLowerCase();
  return ALLOWED_SAME_SITE.has(raw) ? raw : 'lax';
}

function shouldUseSecureCookies() {
  const raw = String(process.env.SESSION_COOKIE_SECURE || '').trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return process.env.NODE_ENV === 'production';
}

function getSessionCookieOptions(expiresAt) {
  const maxAge = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: getCookieSameSite(),
    path: '/',
    secure: shouldUseSecureCookies(),
    expires: expiresAt,
    maxAge,
    priority: 'high',
  };
}

function getCsrfCookieOptions() {
  const expiresAt = getExpiryDate();
  return {
    name: CSRF_COOKIE,
    httpOnly: false,
    sameSite: getCookieSameSite(),
    path: '/',
    secure: shouldUseSecureCookies(),
    expires: expiresAt,
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    priority: 'high',
  };
}

function safeTokenEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getRequestOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin) return origin;

  const referer = request.headers.get('referer');
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function getAllowedOrigins(request) {
  const allowed = new Set();

  try {
    allowed.add(new URL(request.url).origin);
  } catch {}

  const appPublicUrl = String(process.env.APP_PUBLIC_URL || '').trim();
  if (appPublicUrl) {
    try {
      allowed.add(new URL(appPublicUrl).origin);
    } catch {}
  }

  const trustedOrigins = String(process.env.CSRF_TRUSTED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  for (const origin of trustedOrigins) {
    try {
      allowed.add(new URL(origin).origin);
    } catch {}
  }

  return allowed;
}

function buildCsrfErrorResponse() {
  return Response.json(
    {
      error: 'CSRF-проверка не пройдена.',
      code: 'CSRF_VALIDATION_FAILED',
    },
    {
      status: 403,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildSessionLabel(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (!ua) return 'Неизвестное устройство';
  if (ua.includes('iphone')) return 'iPhone';
  if (ua.includes('ipad')) return 'iPad';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'Mac';
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('linux')) return 'Linux';
  return 'Устройство';
}

function getIpAddress(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
}

function getAdminIdSet() {
  return new Set(
    String(process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item > 0)
  );
}

function getAdminKeySet() {
  return new Set(
    String(process.env.ADMIN_USER_KEYS || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

function buildUserAdminKeys(user) {
  if (!user) return [];
  const first = String(user.firstName || '').trim().toLowerCase();
  const last = String(user.lastName || '').trim().toLowerCase();
  const compact = `${first}${last}`;
  return [
    String(user.normalizedKey || '').trim().toLowerCase(),
    compact,
    `${first}.${last}`,
    `${first}_${last}`,
    `${first}-${last}`,
  ].filter(Boolean);
}

export function getExpiryDate() {
  const now = new Date();
  now.setDate(now.getDate() + SESSION_TTL_DAYS);
  return now;
}

export async function createSessionForUser(userId, request, options = {}) {
  const plainToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(plainToken);
  const expiresAt = getExpiryDate();
  const userAgent = request?.headers?.get('user-agent') || null;
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash,
      label: buildSessionLabel(userAgent),
      ipAddress: request ? getIpAddress(request) : null,
      userAgent,
      expiresAt,
    },
  });

  if (request) {
    try {
      await attachSessionToDevice({ sessionId: session.id, userId, request, deviceContext: options.deviceContext || {} });
      const refreshed = await prisma.session.findUnique({ where: { id: session.id } });
      return { plainToken, session: refreshed || session };
    } catch (deviceError) {
      console.error('device attach failed', deviceError);
    }
  }

  return { plainToken, session };
}

export function applySessionCookie(response, plainToken, expiresAt) {
  response.cookies.set({
    ...getSessionCookieOptions(expiresAt),
    value: plainToken,
  });
  return response;
}

export function clearSessionCookie(response) {
  response.cookies.set({
    ...getSessionCookieOptions(new Date(0)),
    value: '',
    maxAge: 0,
  });
  return response;
}

export async function getSessionRecordFromCookieStore(cookieStore) {
  const plainToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!plainToken) return null;
  const tokenHash = sha256(plainToken);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session;
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  return getSessionRecordFromCookieStore(cookieStore);
}

export async function touchSession(sessionId) {
  const updated = await prisma.session.update({
    where: { id: sessionId },
    data: { lastSeenAt: new Date() },
    select: { id: true },
  }).catch(() => null);

  if (updated) {
    await touchDeviceForSession(updated.id).catch(() => null);
  }
}

export function createCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function applyCsrfCookie(response, token = createCsrfToken()) {
  response.cookies.set({
    ...getCsrfCookieOptions(),
    value: token,
  });
  return token;
}

export function ensureCsrfCookie(response, request) {
  const existingToken = request?.cookies?.get(CSRF_COOKIE)?.value;
  if (existingToken) {
    applyCsrfCookie(response, existingToken);
    return existingToken;
  }
  return applyCsrfCookie(response);
}

export function clearCsrfCookie(response) {
  response.cookies.set({
    ...getCsrfCookieOptions(),
    value: '',
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}

export function verifyCsrf(request) {
  const method = String(request.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true, via: 'safe-method' };
  }

  const requestOrigin = getRequestOrigin(request);
  const allowedOrigins = getAllowedOrigins(request);
  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    return { ok: true, via: 'origin' };
  }

  const cookieToken = request.cookies.get(CSRF_COOKIE)?.value;
  const headerToken = request.headers.get('x-csrf-token');

  if (safeTokenEqual(cookieToken, headerToken)) {
    return { ok: true, via: 'double-submit-token' };
  }

  return {
    ok: false,
    response: buildCsrfErrorResponse(),
  };
}


export function isAdminUser(user) {
  if (!user) return false;

  const idSet = getAdminIdSet();
  if (idSet.has(Number(user.id))) return true;

  const keySet = getAdminKeySet();
  if (!keySet.size) return false;

  return buildUserAdminKeys(user).some((key) => keySet.has(key));
}

export async function requireAdminSession() {
  const session = await getCurrentSession();
  if (!session || !isAdminUser(session.user)) return null;
  return session;
}

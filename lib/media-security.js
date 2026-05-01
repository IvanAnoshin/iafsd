import path from 'node:path';

const MB = 1024 * 1024;
const DEFAULT_USER_DAILY_BYTES = 512 * MB;
const DEFAULT_SCOPE_DAILY_BYTES = 2 * 1024 * MB;
const TEXT_MIME = new Set(['text/plain', 'text/csv', 'application/json']);
const ZIP_COMPATIBLE_MIME = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const MP4_COMPATIBLE_MIME = new Set(['video/mp4', 'video/quicktime', 'audio/mp4']);
const WAV_COMPATIBLE_MIME = new Set(['audio/wav', 'audio/x-wav']);
const DANGEROUS_EXTENSIONS = new Set([
  '.app', '.apk', '.bat', '.bin', '.cmd', '.com', '.cpl', '.dll', '.dmg', '.exe', '.gadget', '.hta', '.html', '.htm', '.iso', '.jar',
  '.js', '.jse', '.lnk', '.mjs', '.msi', '.php', '.ps1', '.reg', '.scr', '.sh', '.svg', '.swf', '.ts', '.vb', '.vbe', '.vbs', '.wsf',
]);

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function normalizeMime(value = '') {
  const raw = String(value || '').split(';')[0].trim().toLowerCase();
  if (raw === 'image/jpg') return 'image/jpeg';
  if (raw === 'application/x-pdf') return 'application/pdf';
  return raw;
}

function cleanFilename(name = '') {
  const base = path.basename(String(name || '').trim());
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || 'file';
}

function extensionOf(filename = '') {
  return path.extname(cleanFilename(filename)).toLowerCase();
}

function startsWith(buffer, bytes) {
  if (!Buffer.isBuffer(buffer) || buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function hasTextLikeContent(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  if (sample.includes(0)) return false;
  return true;
}

export function sniffMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) || startsWith(buffer, [0x50, 0x4b, 0x07, 0x08])) return 'application/zip';
  if (startsWith(buffer, [0x1f, 0x8b])) return 'application/gzip';
  if (startsWith(buffer, [0x4f, 0x67, 0x67, 0x53])) return 'audio/ogg';
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (startsWith(buffer, [0x49, 0x44, 0x33])) return 'audio/mpeg';
  if (startsWith(buffer, [0xff, 0xfb]) || startsWith(buffer, [0xff, 0xf3]) || startsWith(buffer, [0xff, 0xf2])) return 'audio/mpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  if (hasTextLikeContent(buffer)) return 'text/plain';
  return null;
}

function isCompatibleMime(declaredMime, detectedMime) {
  const declared = normalizeMime(declaredMime);
  const detected = normalizeMime(detectedMime);
  if (!detected) return true;
  if (declared === detected) return true;
  if (ZIP_COMPATIBLE_MIME.has(declared) && detected === 'application/zip') return true;
  if (MP4_COMPATIBLE_MIME.has(declared) && detected === 'video/mp4') return true;
  if (WAV_COMPATIBLE_MIME.has(declared) && detected === 'audio/wav') return true;
  if (TEXT_MIME.has(declared) && detected === 'text/plain') return true;
  return false;
}

export function validateUploadSecurity({ buffer, filename, mime, allowedMime = [], allowedExtensions = [], surface = 'media' }) {
  const originalName = cleanFilename(filename || 'file');
  const extension = extensionOf(originalName);
  const normalizedMime = normalizeMime(mime);
  const allowedMimeSet = new Set(allowedMime.map(normalizeMime));
  const allowedExtensionSet = new Set(allowedExtensions.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean));

  if (!normalizedMime || !allowedMimeSet.has(normalizedMime)) {
    throw Object.assign(new Error('Этот тип файла не поддерживается.'), { status: 400, code: 'MEDIA_MIME_NOT_ALLOWED' });
  }
  if (!extension || !allowedExtensionSet.has(extension)) {
    throw Object.assign(new Error('Расширение файла не соответствует разрешённому типу.'), { status: 400, code: 'MEDIA_EXTENSION_NOT_ALLOWED' });
  }
  if (DANGEROUS_EXTENSIONS.has(extension) || normalizedMime === 'image/svg+xml' || normalizedMime === 'text/html') {
    throw Object.assign(new Error('Этот формат файла заблокирован по соображениям безопасности.'), { status: 400, code: 'MEDIA_DANGEROUS_EXTENSION' });
  }

  const detectedMime = sniffMime(buffer);
  if (detectedMime && !isCompatibleMime(normalizedMime, detectedMime)) {
    throw Object.assign(new Error('Содержимое файла не совпадает с заявленным типом.'), {
      status: 400,
      code: 'MEDIA_MIME_SNIFF_MISMATCH',
      details: { surface, declared_mime: normalizedMime, detected_mime: detectedMime },
    });
  }

  return { originalName, extension, mime: normalizedMime, detectedMime };
}

export function getMediaQuotaConfig(prefix = 'MEDIA') {
  return {
    userDailyBytes: intEnv(`${prefix}_USER_DAILY_BYTES`, intEnv('STORAGE_USER_DAILY_BYTES', DEFAULT_USER_DAILY_BYTES)),
    scopeDailyBytes: intEnv(`${prefix}_SCOPE_DAILY_BYTES`, intEnv('STORAGE_SCOPE_DAILY_BYTES', DEFAULT_SCOPE_DAILY_BYTES)),
  };
}

function dayStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function sumBytes(db, where) {
  if (!db?.mediaObject?.aggregate) return 0;
  const result = await db.mediaObject.aggregate({ where, _sum: { bytes: true } });
  return Number(result?._sum?.bytes || 0);
}

export async function enforceMediaQuota({ db, prefix = 'MEDIA', ownerUserId, surface = 'media', scopeId = null, bytes = 0 }) {
  if (!db?.mediaObject?.aggregate) return { skipped: true };
  const requestedBytes = Number(bytes || 0);
  if (!Number.isFinite(requestedBytes) || requestedBytes <= 0) return { skipped: true };

  const config = getMediaQuotaConfig(prefix);
  const createdAt = { gte: dayStart() };
  const active = { status: 'active', createdAt };

  if (ownerUserId && config.userDailyBytes > 0) {
    const used = await sumBytes(db, { ...active, ownerUserId: Number(ownerUserId) });
    if (used + requestedBytes > config.userDailyBytes) {
      throw Object.assign(new Error('Дневной лимит загрузки медиа для пользователя исчерпан.'), { status: 413, code: 'MEDIA_USER_DAILY_QUOTA_EXCEEDED' });
    }
  }

  if (scopeId && config.scopeDailyBytes > 0) {
    const used = await sumBytes(db, { ...active, surface, scopeId: String(scopeId) });
    if (used + requestedBytes > config.scopeDailyBytes) {
      throw Object.assign(new Error('Дневной лимит загрузки медиа для этого раздела исчерпан.'), { status: 413, code: 'MEDIA_SCOPE_DAILY_QUOTA_EXCEEDED' });
    }
  }

  return { skipped: false };
}

export async function recordMediaObject({ db, ownerUserId = null, surface = 'media', scopeType = null, scopeId = null, kind = 'file', mime = '', detectedMime = null, storage = 'local', storageKey = null, previewStorageKey = null, url = null, thumbUrl = null, bytes = 0, previewBytes = 0, metadata = {} }) {
  if (!db?.mediaObject?.create) return { skipped: true };
  try {
    return await db.mediaObject.create({
      data: {
        ownerUserId: ownerUserId ? Number(ownerUserId) : null,
        surface: String(surface || 'media').slice(0, 40),
        scopeType: scopeType ? String(scopeType).slice(0, 40) : null,
        scopeId: scopeId ? String(scopeId).slice(0, 120) : null,
        kind: String(kind || 'file').slice(0, 40),
        mime: normalizeMime(mime).slice(0, 120),
        detectedMime: detectedMime ? normalizeMime(detectedMime).slice(0, 120) : null,
        storage: String(storage || 'local').slice(0, 40),
        storageKey: storageKey ? String(storageKey).slice(0, 700) : null,
        previewStorageKey: previewStorageKey ? String(previewStorageKey).slice(0, 700) : null,
        url: url ? String(url).slice(0, 1000) : null,
        thumbUrl: thumbUrl ? String(thumbUrl).slice(0, 1000) : null,
        bytes: Math.max(0, Math.trunc(Number(bytes || 0))),
        previewBytes: Math.max(0, Math.trunc(Number(previewBytes || 0))),
        status: 'active',
        metadata,
      },
    });
  } catch (error) {
    console.warn('[media] failed to record media object:', error?.message || error);
    return { skipped: true, error: error?.message || String(error) };
  }
}

export async function markMediaObjectDeleted({ db, storageKey = null, url = null }) {
  if (!db?.mediaObject?.updateMany) return { skipped: true };
  const where = storageKey ? { storageKey: String(storageKey) } : url ? { url: String(url) } : null;
  if (!where) return { skipped: true };
  return db.mediaObject.updateMany({ where, data: { status: 'deleted', deletedAt: new Date() } }).catch((error) => ({ skipped: true, error: error?.message || String(error) }));
}

export function getStorageProxyHeaders() {
  return {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  };
}

function envBool(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function normalizeReferenceUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[\u0000-\u001f\u007f]/.test(raw)) return '';
  const lower = raw.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:') || lower.startsWith('file:')) return '';
  if (raw.startsWith('/')) return raw.slice(0, 1000);
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.toString().slice(0, 1000);
  } catch {
    return '';
  }
}

function mediaReferenceValues(item = {}) {
  const values = [
    normalizeReferenceUrl(item.url || item.mediaUrl),
    normalizeReferenceUrl(item.thumbUrl || item.thumb_url || item.thumbnailUrl),
    String(item.storageKey || item.storage_key || '').trim(),
    String(item.previewStorageKey || item.preview_storage_key || '').trim(),
  ].filter(Boolean);
  return [...new Set(values)];
}

function buildMediaReferenceWhere(values) {
  const or = [];
  for (const value of values) {
    if (!value) continue;
    or.push({ url: value }, { thumbUrl: value }, { storageKey: value }, { previewStorageKey: value });
  }
  return or.length ? { OR: or } : null;
}

function isAllowedSurface(record, allowedSurfaces) {
  if (!allowedSurfaces?.length) return true;
  return allowedSurfaces.includes(String(record?.surface || ''));
}

function isAllowedScope(record, allowedScopeIds) {
  if (!allowedScopeIds?.length) return true;
  return allowedScopeIds.map(String).includes(String(record?.scopeId || ''));
}

export function sanitizeClientMediaUrl(value = '') {
  return normalizeReferenceUrl(value);
}

export async function assertMediaReferencesBelongToScope({ db, media = [], ownerUserId, allowedSurfaces = [], allowedScopeIds = [], label = 'медиа' } = {}) {
  const items = Array.isArray(media) ? media : [];
  if (!items.length) return { checked: 0, skipped: false };
  if (!db?.mediaObject?.findFirst) return { checked: 0, skipped: true, reason: 'mediaObject_unavailable' };

  const strict = process.env.NODE_ENV === 'production' || envBool('MEDIA_REFERENCE_STRICT', false);
  let checked = 0;

  for (const item of items) {
    const values = mediaReferenceValues(item);
    if (!values.length) continue;
    checked += 1;

    const where = buildMediaReferenceWhere(values);
    const record = where ? await db.mediaObject.findFirst({ where: { status: 'active', ...where } }).catch(() => null) : null;

    if (!record) {
      if (!strict) continue;
      throw Object.assign(new Error(`Нельзя прикрепить неподтверждённое ${label}. Загрузите файл заново.`), { status: 400, code: 'MEDIA_REFERENCE_NOT_REGISTERED' });
    }

    if (ownerUserId && Number(record.ownerUserId || 0) !== Number(ownerUserId)) {
      throw Object.assign(new Error(`Нельзя прикрепить чужое ${label}.`), { status: 403, code: 'MEDIA_REFERENCE_OWNER_MISMATCH' });
    }

    if (!isAllowedSurface(record, allowedSurfaces) || !isAllowedScope(record, allowedScopeIds)) {
      throw Object.assign(new Error(`Это ${label} нельзя использовать здесь.`), { status: 403, code: 'MEDIA_REFERENCE_SCOPE_MISMATCH' });
    }
  }

  return { checked, skipped: false };
}

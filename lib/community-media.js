import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  deleteObject,
  getObjectPublicUrl,
  getObjectStorageConfig,
  getObjectStorageKeyFromPublicUrl,
  putObject,
} from '@/lib/object-storage';
import { buildMediaPreviewSvg, buildObjectPreviewKey, MEDIA_PREVIEW_MIME, shouldGeneratePreview, writeLocalPreview } from '@/lib/media-previews';
import { enforceMediaQuota, markMediaObjectDeleted, recordMediaObject, validateUploadSecurity } from '@/lib/media-security';
import prisma from '@/lib/prisma';

const MB = 1024 * 1024;
const ROOT_PUBLIC_DIR = path.join(process.cwd(), 'public');
const ROOT_UPLOADS_DIR = path.join(ROOT_PUBLIC_DIR, 'uploads', 'communities');
const INTERNAL_OBJECT_PREFIX = '/api/storage/community/';

const RULES = {
  image: {
    kind: 'image',
    maxBytes: 12 * MB,
    allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    extensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
  },
  video: {
    kind: 'video',
    maxBytes: 80 * MB,
    allowedMime: ['video/mp4', 'video/webm', 'video/quicktime'],
    extensions: ['.mp4', '.webm', '.mov'],
  },
};

const MIME_TO_KIND = new Map([
  ['image/jpeg', 'image'],
  ['image/png', 'image'],
  ['image/webp', 'image'],
  ['image/gif', 'image'],
  ['video/mp4', 'video'],
  ['video/webm', 'video'],
  ['video/quicktime', 'video'],
]);

function envNumber(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

function envBool(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function normalizeStorage(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'object' || raw === 's3-compatible') return 's3';
  if (raw === 'cloudflare-r2') return 'r2';
  if (raw === 'yandex-s3' || raw === 'yc') return 'yandex';
  return raw || 'local';
}

function assertCommunityLocalStorageAllowed(config) {
  if (config.storage !== 'local') return;
  if (process.env.NODE_ENV !== 'production') return;
  if (envBool('COMMUNITY_MEDIA_ALLOW_LOCAL_IN_PRODUCTION', false)) return;
  throw Object.assign(new Error('Локальное хранилище для медиа сообществ отключено в production. Настрой object storage или явно включи COMMUNITY_MEDIA_ALLOW_LOCAL_IN_PRODUCTION=true.'), { status: 500, code: 'LOCAL_MEDIA_STORAGE_BLOCKED' });
}

export function getCommunityMediaConfig() {
  const image = { ...RULES.image, allowedMime: [...RULES.image.allowedMime], extensions: [...RULES.image.extensions] };
  const video = { ...RULES.video, allowedMime: [...RULES.video.allowedMime], extensions: [...RULES.video.extensions] };
  image.maxBytes = envNumber('COMMUNITY_MEDIA_IMAGE_MAX_BYTES', image.maxBytes);
  video.maxBytes = envNumber('COMMUNITY_MEDIA_VIDEO_MAX_BYTES', video.maxBytes);
  const storage = normalizeStorage(process.env.COMMUNITY_MEDIA_STORAGE || 'local');
  const objectStorage = getObjectStorageConfig('COMMUNITY_MEDIA');
  return {
    enabled: String(process.env.COMMUNITY_MEDIA_ENABLED || 'true').trim().toLowerCase() !== 'false',
    storage,
    basePath: '/uploads/communities',
    objectBasePath: INTERNAL_OBJECT_PREFIX,
    privateStorage: Boolean(objectStorage.privateAccess),
    publicBaseUrl: objectStorage.publicBaseUrl || null,
    stripJpegExif: envBool('COMMUNITY_MEDIA_STRIP_JPEG_EXIF', true),
    previews: {
      enabled: envBool('COMMUNITY_MEDIA_PREVIEWS_ENABLED', true),
      mode: String(process.env.COMMUNITY_MEDIA_PREVIEWS_MODE || 'svg-poster').trim().toLowerCase(),
    },
    thumbnails: {
      enabled: envBool('COMMUNITY_MEDIA_THUMBNAILS_ENABLED', false),
      mode: String(process.env.COMMUNITY_MEDIA_THUMBNAILS_MODE || 'off').trim().toLowerCase(),
    },
    limits: { image, video },
  };
}

export function serializeCommunityMediaConfig(config = getCommunityMediaConfig()) {
  return {
    enabled: Boolean(config.enabled),
    storage: config.storage,
    base_path: config.basePath,
    object_base_path: config.objectBasePath,
    private_storage: Boolean(config.privateStorage),
    public_base_url: config.publicBaseUrl,
    strip_jpeg_exif: Boolean(config.stripJpegExif),
    previews: { ...config.previews },
    thumbnails: { ...config.thumbnails },
    limits: Object.fromEntries(Object.entries(config.limits).map(([key, rule]) => [key, {
      max_bytes: rule.maxBytes,
      allowed_mime: [...rule.allowedMime],
      extensions: [...rule.extensions],
    }])),
  };
}

function cleanFilename(name = '') {
  const base = path.basename(String(name || '').trim());
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || 'file';
}

function inferKind(mime, requestedKind) {
  const requested = String(requestedKind || '').trim().toLowerCase();
  if (requested === 'image' || requested === 'video') return requested;
  return MIME_TO_KIND.get(String(mime || '').trim().toLowerCase()) || 'image';
}

function inferExt(filename, mime, allowed = []) {
  const fromName = path.extname(cleanFilename(filename)).toLowerCase();
  if (fromName && allowed.includes(fromName)) return fromName;
  const rawMime = String(mime || '').trim().toLowerCase();
  if (rawMime === 'image/jpeg') return '.jpg';
  if (rawMime === 'image/png') return '.png';
  if (rawMime === 'image/webp') return '.webp';
  if (rawMime === 'image/gif') return '.gif';
  if (rawMime === 'video/mp4') return '.mp4';
  if (rawMime === 'video/webm') return '.webm';
  if (rawMime === 'video/quicktime') return '.mov';
  return allowed[0] || '.bin';
}

function positiveInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.trunc(number);
  return rounded > 0 ? rounded : null;
}

function normalizePurpose(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'avatar' || raw === 'cover' || raw === 'post' || raw === 'gallery') return raw;
  return 'post';
}

function isObjectStorageMode(storage) {
  return ['s3', 'r2', 'yandex'].includes(storage);
}

function encodeStorageKeyForRoute(key) {
  return String(key || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function makeInternalObjectUrl(key) {
  return `${INTERNAL_OBJECT_PREFIX}${encodeStorageKeyForRoute(key)}`;
}

function objectUrlForKey(key) {
  const objectConfig = getObjectStorageConfig('COMMUNITY_MEDIA');
  if (!objectConfig.privateAccess) return getObjectPublicUrl(key, objectConfig);
  return makeInternalObjectUrl(key);
}

export function getCommunityStorageKeyFromUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (raw.startsWith(INTERNAL_OBJECT_PREFIX)) {
    return decodeURIComponent(raw.slice(INTERNAL_OBJECT_PREFIX.length)).replace(/^\/+|\/+$/g, '');
  }
  return getObjectStorageKeyFromPublicUrl(raw, getObjectStorageConfig('COMMUNITY_MEDIA'));
}

function communityIdFromObjectKey(key) {
  const parts = String(key || '').split('/').filter(Boolean);
  if (parts[0] !== 'communities') return null;
  const id = Number(parts[1] || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function isCommunityUploadUrl(url, communityId) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (raw.startsWith('/uploads/communities/')) {
    if (!communityId) return true;
    return raw.startsWith(`/uploads/communities/${communityId}/`);
  }
  const storageKey = getCommunityStorageKeyFromUrl(raw);
  if (!storageKey) return false;
  if (!communityId) return storageKey.startsWith('communities/');
  return Number(communityIdFromObjectKey(storageKey)) === Number(communityId);
}

function resolveCommunityUploadPathFromUrl(url, communityId) {
  const raw = String(url || '').trim();
  if (!raw.startsWith('/uploads/communities/')) return null;
  if (!isCommunityUploadUrl(raw, communityId)) return null;
  const relative = raw.replace(/^\/uploads\/communities\//, '');
  const targetPath = path.join(ROOT_UPLOADS_DIR, ...relative.split('/').filter(Boolean));
  const normalizedRoot = path.normalize(ROOT_UPLOADS_DIR + path.sep);
  const normalizedTarget = path.normalize(targetPath);
  if (!normalizedTarget.startsWith(normalizedRoot)) return null;
  return normalizedTarget;
}

function stripJpegExif(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return { buffer, stripped: false };
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return { buffer, stripped: false };
  const chunks = [buffer.subarray(0, 2)];
  let offset = 2;
  let stripped = false;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    if (marker === 0xda) {
      chunks.push(buffer.subarray(offset));
      return { buffer: stripped ? Buffer.concat(chunks) : buffer, stripped };
    }
    const length = buffer.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > buffer.length) break;
    if (marker === 0xe1) {
      stripped = true;
    } else {
      chunks.push(buffer.subarray(offset, end));
    }
    offset = end;
  }
  if (!stripped) return { buffer, stripped: false };
  chunks.push(buffer.subarray(offset));
  return { buffer: Buffer.concat(chunks), stripped: true };
}

function readUploadBuffer(source, mime, config) {
  if (config.stripJpegExif && mime === 'image/jpeg') return stripJpegExif(source);
  return { buffer: source, stripped: false };
}

export async function deleteCommunityUpload({ url, communityId, storageKey }) {
  const key = storageKey || getCommunityStorageKeyFromUrl(url);
  if (key) {
    const keyCommunityId = communityIdFromObjectKey(key);
    if (communityId && Number(keyCommunityId) !== Number(communityId)) return { deleted: false, skipped: true };
    const objectConfig = getObjectStorageConfig('COMMUNITY_MEDIA');
    if (!objectConfig.enabled) return { deleted: false, skipped: true };
    const result = await deleteObject({ key, config: objectConfig });
    if (result?.deleted) await markMediaObjectDeleted({ db: prisma, storageKey: key });
    return result;
  }

  const targetPath = resolveCommunityUploadPathFromUrl(url, communityId);
  if (!targetPath) return { deleted: false, skipped: true };
  try {
    await unlink(targetPath);
    await markMediaObjectDeleted({ db: prisma, url });
    return { deleted: true, skipped: false };
  } catch (error) {
    if (error?.code === 'ENOENT') return { deleted: false, skipped: true, missing: true };
    throw error;
  }
}

export async function storeCommunityUpload({ file, userId, communityId, kind, purpose, metadata = {} }) {
  const config = getCommunityMediaConfig();
  if (!config.enabled) throw Object.assign(new Error('Загрузка медиа для сообществ сейчас отключена.'), { status: 503 });
  assertCommunityLocalStorageAllowed(config);
  if (!(file instanceof File)) throw Object.assign(new Error('Не найден файл для загрузки.'), { status: 400 });

  const rawMime = String(file.type || '').trim().toLowerCase();
  const declaredMime = rawMime.split(';')[0].trim();
  const normalizedKind = inferKind(declaredMime, kind);
  const rule = config.limits[normalizedKind] || config.limits.image;
  const size = Number(file.size || 0);

  if (!size || size > rule.maxBytes) throw Object.assign(new Error('Файл превышает допустимый размер для сообщества.'), { status: 400 });

  const safeCommunityId = String(communityId || 'unknown');
  const normalizedPurpose = normalizePurpose(purpose);
  await enforceMediaQuota({ db: prisma, prefix: 'COMMUNITY_MEDIA', ownerUserId: userId, surface: 'community', scopeId: safeCommunityId, bytes: size });

  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const security = validateUploadSecurity({
    buffer: sourceBuffer,
    filename: file.name || 'file',
    mime: declaredMime,
    allowedMime: rule.allowedMime,
    allowedExtensions: rule.extensions,
    surface: 'community',
  });
  const mime = security.mime;
  const originalName = security.originalName;
  const ext = inferExt(originalName, mime, rule.extensions);

  const now = new Date();
  const parts = [safeCommunityId, normalizedPurpose, String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0')];
  const filename = `${now.getTime()}-${crypto.randomUUID()}${ext}`;
  const { buffer, stripped } = readUploadBuffer(sourceBuffer, mime, config);

  let publicUrl = '';
  let storageKey = null;
  let thumbUrl = null;
  let previewStorageKey = null;
  let previewBytes = 0;

  if (config.storage === 'local') {
    const targetDir = path.join(ROOT_UPLOADS_DIR, ...parts);
    await mkdir(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, filename);
    await writeFile(targetPath, buffer);
    publicUrl = path.posix.join('/uploads/communities', ...parts, filename);
    if (config.previews?.enabled && shouldGeneratePreview(normalizedKind, mime)) {
      const previewBuffer = buildMediaPreviewSvg({ kind: normalizedKind, mime, originalName });
      const preview = await writeLocalPreview({ rootDir: ROOT_UPLOADS_DIR, basePath: '/uploads/communities', parts, filename, previewBuffer });
      thumbUrl = preview.thumbUrl;
      previewBytes = preview.previewBytes;
    }
  } else if (isObjectStorageMode(config.storage)) {
    storageKey = ['communities', ...parts, filename].join('/');
    const objectConfig = getObjectStorageConfig('COMMUNITY_MEDIA');
    await putObject({ key: storageKey, body: buffer, contentType: mime, cacheControl: objectConfig.cacheControl, config: objectConfig });
    publicUrl = objectUrlForKey(storageKey);
    if (config.previews?.enabled && shouldGeneratePreview(normalizedKind, mime)) {
      const previewBuffer = buildMediaPreviewSvg({ kind: normalizedKind, mime, originalName });
      previewStorageKey = buildObjectPreviewKey({ rootPrefix: 'communities', parts, filename });
      const objectConfigForPreview = getObjectStorageConfig('COMMUNITY_MEDIA');
      await putObject({ key: previewStorageKey, body: previewBuffer, contentType: MEDIA_PREVIEW_MIME, cacheControl: objectConfigForPreview.cacheControl, config: objectConfigForPreview });
      thumbUrl = objectUrlForKey(previewStorageKey);
      previewBytes = previewBuffer.length;
    }
  } else {
    throw Object.assign(new Error(`Неподдерживаемое community media storage: ${config.storage}`), { status: 500 });
  }

  await recordMediaObject({
    db: prisma,
    ownerUserId: userId,
    surface: 'community',
    scopeType: 'community',
    scopeId: safeCommunityId,
    kind: normalizedKind,
    mime,
    detectedMime: security.detectedMime,
    storage: config.storage,
    storageKey,
    previewStorageKey,
    url: publicUrl,
    thumbUrl: normalizedKind === 'image' ? publicUrl : thumbUrl,
    bytes: buffer.length,
    previewBytes,
    metadata: { purpose: normalizedPurpose, originalName, exifStripped: stripped, private: isObjectStorageMode(config.storage) ? getObjectStorageConfig('COMMUNITY_MEDIA').privateAccess : false },
  });

  return {
    kind: normalizedKind,
    purpose: normalizedPurpose,
    url: publicUrl,
    thumbUrl: normalizedKind === 'image' ? publicUrl : thumbUrl,
    storage: config.storage,
    storageKey,
    previewStorageKey,
    previewBytes,
    previewMime: thumbUrl && normalizedKind !== 'image' ? MEDIA_PREVIEW_MIME : null,
    previewGenerated: Boolean(thumbUrl && normalizedKind !== 'image'),
    private: isObjectStorageMode(config.storage) ? getObjectStorageConfig('COMMUNITY_MEDIA').privateAccess : false,
    mime,
    detectedMime: security.detectedMime,
    bytes: buffer.length,
    originalBytes: size,
    exifStripped: stripped,
    width: positiveInt(metadata.width),
    height: positiveInt(metadata.height),
    durationSec: positiveInt(metadata.durationSec || metadata.duration || metadata.durationSeconds),
    originalName,
    uploadedByUserId: Number(userId || 0) || null,
    communityId: Number(communityId || 0) || null,
  };
}

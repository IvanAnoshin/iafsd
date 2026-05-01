import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { deleteObject, getObjectPublicUrl, getObjectStorageConfig, getObjectStorageKeyFromPublicUrl, putObject } from '@/lib/object-storage';
import { buildMediaPreviewSvg, buildObjectPreviewKey, MEDIA_PREVIEW_MIME, shouldGeneratePreview, writeLocalPreview } from '@/lib/media-previews';
import { enforceMediaQuota, markMediaObjectDeleted, recordMediaObject, validateUploadSecurity } from '@/lib/media-security';
import prisma from '@/lib/prisma';

const MB = 1024 * 1024;
const ROOT_PUBLIC_DIR = path.join(process.cwd(), 'public');
const ROOT_UPLOADS_DIR = path.join(ROOT_PUBLIC_DIR, 'uploads', 'stories');
const INTERNAL_OBJECT_PREFIX = '/api/storage/story/';

const DEFAULT_CONFIG = {
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
  if (raw === 'r2' || raw === 'cloudflare-r2') return 'r2';
  if (raw === 'yandex' || raw === 'yandex-s3' || raw === 'yc') return 'yandex';
  if (raw === 's3' || raw === 'object' || raw === 's3-compatible') return 's3';
  return 'local';
}

function isObjectStorageMode(storage) {
  return ['s3', 'r2', 'yandex'].includes(storage);
}

function cloneRule(rule) {
  return { ...rule, allowedMime: [...rule.allowedMime], extensions: [...rule.extensions] };
}

function assertStoryLocalStorageAllowed(config) {
  if (config.storage !== 'local') return;
  if (process.env.NODE_ENV !== 'production') return;
  if (envBool('STORY_MEDIA_ALLOW_LOCAL_IN_PRODUCTION', false)) return;
  throw Object.assign(new Error('Локальное хранилище для медиа моментов отключено в production. Настрой object storage или явно включи STORY_MEDIA_ALLOW_LOCAL_IN_PRODUCTION=true.'), { status: 500, code: 'LOCAL_MEDIA_STORAGE_BLOCKED' });
}

export function getStoryMediaConfig() {
  const image = cloneRule(DEFAULT_CONFIG.image);
  const video = cloneRule(DEFAULT_CONFIG.video);
  image.maxBytes = envNumber('STORY_MEDIA_IMAGE_MAX_BYTES', image.maxBytes);
  video.maxBytes = envNumber('STORY_MEDIA_VIDEO_MAX_BYTES', video.maxBytes);
  const objectStorage = getObjectStorageConfig('STORY_MEDIA');
  const storage = normalizeStorage(process.env.STORY_MEDIA_STORAGE || objectStorage.provider || 'local');
  return {
    enabled: String(process.env.STORY_MEDIA_ENABLED || 'true').trim().toLowerCase() !== 'false',
    storage,
    basePath: '/uploads/stories',
    objectBasePath: 'stories',
    privateStorage: isObjectStorageMode(storage) ? Boolean(objectStorage.privateAccess) : false,
    publicBaseUrl: objectStorage.publicBaseUrl || null,
    stripJpegExif: envBool('STORY_MEDIA_STRIP_JPEG_EXIF', true),
    previews: {
      enabled: envBool('STORY_MEDIA_PREVIEWS_ENABLED', true),
      mode: String(process.env.STORY_MEDIA_PREVIEWS_MODE || 'svg-poster').trim().toLowerCase(),
    },
    limits: { image, video },
  };
}

export function serializeStoryMediaConfig(config = getStoryMediaConfig()) {
  return {
    enabled: Boolean(config.enabled),
    storage: config.storage,
    base_path: config.basePath,
    object_base_path: config.objectBasePath,
    private_storage: Boolean(config.privateStorage),
    public_base_url: config.publicBaseUrl,
    strip_jpeg_exif: Boolean(config.stripJpegExif),
    previews: { ...config.previews },
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

function parsePositiveInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.trunc(number);
  return rounded > 0 ? rounded : null;
}

function encodeStorageKeyForRoute(key) {
  return String(key || '').split('/').filter(Boolean).map((segment) => encodeURIComponent(segment)).join('/');
}

function makeInternalObjectUrl(key) {
  return `${INTERNAL_OBJECT_PREFIX}${encodeStorageKeyForRoute(key)}`;
}

function objectUrlForKey(key) {
  const objectConfig = getObjectStorageConfig('STORY_MEDIA');
  if (!objectConfig.privateAccess) return getObjectPublicUrl(key, objectConfig);
  return makeInternalObjectUrl(key);
}

export function getStoryStorageKeyFromUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (raw.startsWith(INTERNAL_OBJECT_PREFIX)) return decodeURIComponent(raw.slice(INTERNAL_OBJECT_PREFIX.length)).replace(/^\/+|\/+$/g, '');
  return getObjectStorageKeyFromPublicUrl(raw, getObjectStorageConfig('STORY_MEDIA'));
}

function userIdFromObjectKey(key) {
  const parts = String(key || '').split('/').filter(Boolean);
  if (parts[0] !== 'stories') return null;
  const id = Number(parts[1] || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function resolvePostUploadPathFromUrl(url, userId) {
  const raw = String(url || '').trim();
  if (!raw.startsWith('/uploads/stories/')) return null;
  const relative = raw.replace(/^\/uploads\/stories\//, '');
  const segments = relative.split('/').filter(Boolean);
  if (String(segments[0]) !== String(userId)) return null;
  const targetPath = path.join(ROOT_UPLOADS_DIR, ...segments);
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
    if (marker === 0xe1) stripped = true;
    else chunks.push(buffer.subarray(offset, end));
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

export async function deleteStoryUpload({ url, userId, storageKey }) {
  const key = storageKey || getStoryStorageKeyFromUrl(url);
  if (key) {
    if (userId && Number(userIdFromObjectKey(key)) !== Number(userId)) return { deleted: false, skipped: true };
    const objectConfig = getObjectStorageConfig('STORY_MEDIA');
    if (!objectConfig.enabled) return { deleted: false, skipped: true };
    const result = await deleteObject({ key, config: objectConfig });
    if (result?.deleted) await markMediaObjectDeleted({ db: prisma, storageKey: key });
    return result;
  }
  const targetPath = resolvePostUploadPathFromUrl(url, userId);
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

export async function storeStoryUpload({ file, userId, kind, metadata = {} }) {
  const config = getStoryMediaConfig();
  if (!config.enabled) throw Object.assign(new Error('Загрузка медиа для моментов сейчас отключена.'), { status: 503 });
  assertStoryLocalStorageAllowed(config);
  if (!(file instanceof File)) throw Object.assign(new Error('Не найден файл для загрузки.'), { status: 400 });

  const rawMime = String(file.type || '').trim().toLowerCase();
  const declaredMime = rawMime.split(';')[0].trim();
  const normalizedKind = inferKind(declaredMime, kind);
  const rule = config.limits[normalizedKind] || config.limits.image;
  const size = Number(file.size || 0);

  if (!size || size > rule.maxBytes) throw Object.assign(new Error('Файл превышает допустимый размер для момента.'), { status: 400 });

  await enforceMediaQuota({ db: prisma, prefix: 'STORY_MEDIA', ownerUserId: userId, surface: 'story', scopeId: userId, bytes: size });

  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const security = validateUploadSecurity({
    buffer: sourceBuffer,
    filename: file.name || 'file',
    mime: declaredMime,
    allowedMime: rule.allowedMime,
    allowedExtensions: rule.extensions,
    surface: 'story',
  });
  const mime = security.mime;
  const originalName = security.originalName;
  const ext = inferExt(originalName, mime, rule.extensions);

  const now = new Date();
  const parts = [String(userId), String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0')];
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
    publicUrl = path.posix.join('/uploads/stories', ...parts, filename);
    if (config.previews?.enabled && shouldGeneratePreview(normalizedKind, mime)) {
      const previewBuffer = buildMediaPreviewSvg({ kind: normalizedKind, mime, originalName });
      const preview = await writeLocalPreview({ rootDir: ROOT_UPLOADS_DIR, basePath: '/uploads/stories', parts, filename, previewBuffer });
      thumbUrl = preview.thumbUrl;
      previewBytes = preview.previewBytes;
    }
  } else if (isObjectStorageMode(config.storage)) {
    storageKey = ['stories', ...parts, filename].join('/');
    const objectConfig = getObjectStorageConfig('STORY_MEDIA');
    await putObject({ key: storageKey, body: buffer, contentType: mime, cacheControl: objectConfig.cacheControl, config: objectConfig });
    publicUrl = objectUrlForKey(storageKey);
    if (config.previews?.enabled && shouldGeneratePreview(normalizedKind, mime)) {
      const previewBuffer = buildMediaPreviewSvg({ kind: normalizedKind, mime, originalName });
      previewStorageKey = buildObjectPreviewKey({ rootPrefix: 'stories', parts, filename });
      const objectConfigForPreview = getObjectStorageConfig('STORY_MEDIA');
      await putObject({ key: previewStorageKey, body: previewBuffer, contentType: MEDIA_PREVIEW_MIME, cacheControl: objectConfigForPreview.cacheControl, config: objectConfigForPreview });
      thumbUrl = objectUrlForKey(previewStorageKey);
      previewBytes = previewBuffer.length;
    }
  } else {
    throw Object.assign(new Error(`Неподдерживаемое story media storage: ${config.storage}`), { status: 500 });
  }

  await recordMediaObject({
    db: prisma,
    ownerUserId: userId,
    surface: 'story',
    scopeType: 'user',
    scopeId: userId,
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
    metadata: { originalName, exifStripped: stripped, private: isObjectStorageMode(config.storage) ? getObjectStorageConfig('STORY_MEDIA').privateAccess : false },
  });

  return {
    kind: normalizedKind,
    url: publicUrl,
    thumbUrl: normalizedKind === 'image' ? publicUrl : thumbUrl,
    storage: config.storage,
    storageKey,
    previewStorageKey,
    previewBytes,
    previewMime: thumbUrl && normalizedKind !== 'image' ? MEDIA_PREVIEW_MIME : null,
    previewGenerated: Boolean(thumbUrl && normalizedKind !== 'image'),
    private: isObjectStorageMode(config.storage) ? getObjectStorageConfig('STORY_MEDIA').privateAccess : false,
    mime,
    detectedMime: security.detectedMime,
    bytes: buffer.length,
    originalBytes: size,
    exifStripped: stripped,
    width: parsePositiveInt(metadata.width),
    height: parsePositiveInt(metadata.height),
    durationSec: parsePositiveInt(metadata.durationSec || metadata.duration || metadata.durationSeconds),
    originalName,
    uploadedByUserId: Number(userId || 0) || null,
  };
}

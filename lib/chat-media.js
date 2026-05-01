import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { deleteObject, getObjectPublicUrl, getObjectStorageConfig, getObjectStorageKeyFromPublicUrl, putObject } from '@/lib/object-storage';
import { buildMediaPreviewSvg, buildObjectPreviewKey, MEDIA_PREVIEW_MIME, shouldGeneratePreview, writeLocalPreview } from '@/lib/media-previews';
import { enforceMediaQuota, markMediaObjectDeleted, recordMediaObject, validateUploadSecurity } from '@/lib/media-security';
import prisma from '@/lib/prisma';

const MB = 1024 * 1024;
const ROOT_PUBLIC_DIR = path.join(process.cwd(), 'public');
const ROOT_UPLOADS_DIR = path.join(ROOT_PUBLIC_DIR, 'uploads', 'chat');
const INTERNAL_OBJECT_PREFIX = '/api/storage/chat/';

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
  file: {
    kind: 'file',
    maxBytes: 40 * MB,
    allowedMime: [
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/json',
      'application/zip',
      'application/x-zip-compressed',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    extensions: ['.pdf', '.txt', '.csv', '.json', '.zip', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'],
  },
  voice: {
    kind: 'voice',
    maxBytes: 16 * MB,
    allowedMime: ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav'],
    extensions: ['.webm', '.ogg', '.mp3', '.mp4', '.wav'],
  },
  video_note: {
    kind: 'video_note',
    maxBytes: 32 * MB,
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
  ['audio/webm', 'voice'],
  ['audio/ogg', 'voice'],
  ['audio/mpeg', 'voice'],
  ['audio/mp4', 'voice'],
  ['audio/wav', 'voice'],
  ['audio/x-wav', 'voice'],
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

function cloneRule(rule) {
  return {
    ...rule,
    allowedMime: [...rule.allowedMime],
    extensions: [...rule.extensions],
  };
}

function assertChatLocalStorageAllowed(config) {
  if (config.storage !== 'local') return;
  if (process.env.NODE_ENV !== 'production') return;
  if (envBool('CHAT_MEDIA_ALLOW_LOCAL_IN_PRODUCTION', false)) return;
  throw Object.assign(new Error('Локальное хранилище для чат-медиа отключено в production. Настрой object storage или явно включи CHAT_MEDIA_ALLOW_LOCAL_IN_PRODUCTION=true.'), { status: 500, code: 'LOCAL_MEDIA_STORAGE_BLOCKED' });
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

export function getChatMediaConfig() {
  const image = cloneRule(DEFAULT_CONFIG.image);
  const video = cloneRule(DEFAULT_CONFIG.video);
  const file = cloneRule(DEFAULT_CONFIG.file);
  const voice = cloneRule(DEFAULT_CONFIG.voice);
  const videoNote = cloneRule(DEFAULT_CONFIG.video_note);

  image.maxBytes = envNumber('CHAT_MEDIA_IMAGE_MAX_BYTES', image.maxBytes);
  video.maxBytes = envNumber('CHAT_MEDIA_VIDEO_MAX_BYTES', video.maxBytes);
  file.maxBytes = envNumber('CHAT_MEDIA_FILE_MAX_BYTES', file.maxBytes);
  voice.maxBytes = envNumber('CHAT_MEDIA_VOICE_MAX_BYTES', voice.maxBytes);
  videoNote.maxBytes = envNumber('CHAT_MEDIA_VIDEO_NOTE_MAX_BYTES', videoNote.maxBytes);

  const objectStorage = getObjectStorageConfig('CHAT_MEDIA');
  const storage = normalizeStorage(process.env.CHAT_MEDIA_STORAGE || objectStorage.provider || 'local');

  return {
    enabled: String(process.env.CHAT_MEDIA_ENABLED || 'true').trim().toLowerCase() !== 'false',
    storage,
    basePath: '/uploads/chat',
    objectBasePath: 'chat',
    privateStorage: isObjectStorageMode(storage) ? Boolean(objectStorage.privateAccess) : false,
    publicBaseUrl: objectStorage.publicBaseUrl || null,
    stripJpegExif: envBool('CHAT_MEDIA_STRIP_JPEG_EXIF', true),
    previews: {
      enabled: envBool('CHAT_MEDIA_PREVIEWS_ENABLED', true),
      mode: String(process.env.CHAT_MEDIA_PREVIEWS_MODE || 'svg-poster').trim().toLowerCase(),
    },
    limits: {
      image,
      video,
      file,
      voice,
      video_note: videoNote,
    },
  };
}

function normalizeType(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw && Object.hasOwn(DEFAULT_CONFIG, raw) ? raw : null;
}

function inferTypeFromMime(mime) {
  const raw = String(mime || '').trim().toLowerCase();
  return MIME_TO_KIND.get(raw) || 'file';
}

function cleanFilename(name = '') {
  const base = path.basename(String(name || '').trim());
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || 'file';
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
  if (rawMime === 'audio/webm') return '.webm';
  if (rawMime === 'audio/ogg') return '.ogg';
  if (rawMime === 'audio/mpeg') return '.mp3';
  if (rawMime === 'audio/mp4') return '.mp4';
  if (rawMime === 'audio/wav' || rawMime === 'audio/x-wav') return '.wav';
  return allowed[0] || '.bin';
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

export function getChatStorageKeyFromUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (raw.startsWith(INTERNAL_OBJECT_PREFIX)) {
    return decodeURIComponent(raw.slice(INTERNAL_OBJECT_PREFIX.length)).replace(/^\/+|\/+$/g, '');
  }
  return getObjectStorageKeyFromPublicUrl(raw, getObjectStorageConfig('CHAT_MEDIA'));
}

function objectUrlForKey(key) {
  const objectConfig = getObjectStorageConfig('CHAT_MEDIA');
  if (!objectConfig.privateAccess) return getObjectPublicUrl(key, objectConfig);
  return makeInternalObjectUrl(key);
}

function normalizeConversationId(value) {
  const raw = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{6,80}$/.test(raw) ? raw : '';
}

function buildChatParts(userId, metadata = {}) {
  const now = new Date();
  const conversationId = normalizeConversationId(metadata.conversationId);
  const scope = conversationId ? ['conversation', conversationId, String(userId)] : ['user', String(userId)];
  return [...scope, String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0')];
}

function resolveChatUploadPathFromUrl(url, userId) {
  const rawUrl = String(url || '').trim();
  if (!rawUrl.startsWith('/uploads/chat/')) return null;
  const relative = rawUrl.replace(/^\/uploads\/chat\//, '');
  const segments = relative.split('/').filter(Boolean);
  if (segments.length < 4) return null;

  const oldUserScoped = String(segments[0]) === String(userId);
  const conversationScoped = segments[0] === 'conversation' && String(segments[2]) === String(userId);
  const newUserScoped = segments[0] === 'user' && String(segments[1]) === String(userId);
  if (!oldUserScoped && !conversationScoped && !newUserScoped) return null;

  const targetPath = path.join(ROOT_UPLOADS_DIR, ...segments);
  const normalizedRoot = path.normalize(ROOT_UPLOADS_DIR + path.sep);
  const normalizedTarget = path.normalize(targetPath);
  if (!normalizedTarget.startsWith(normalizedRoot)) return null;
  return normalizedTarget;
}

function keyBelongsToUser(key, userId) {
  const parts = String(key || '').split('/').filter(Boolean);
  if (parts[0] !== 'chat') return false;
  if (parts[1] === 'user') return String(parts[2]) === String(userId);
  if (parts[1] === 'conversation') return String(parts[3]) === String(userId);
  return false;
}

export async function deleteChatUpload({ url, userId, storageKey }) {
  const key = storageKey || getChatStorageKeyFromUrl(url);
  if (key) {
    if (!keyBelongsToUser(key, userId)) return { deleted: false, skipped: true, url: String(url || '') || null };
    const objectConfig = getObjectStorageConfig('CHAT_MEDIA');
    if (!objectConfig.enabled) return { deleted: false, skipped: true, url: String(url || '') || null };
    const result = await deleteObject({ key, config: objectConfig });
    if (result?.deleted) await markMediaObjectDeleted({ db: prisma, storageKey: key });
    return result;
  }

  const targetPath = resolveChatUploadPathFromUrl(url, userId);
  if (!targetPath) return { deleted: false, skipped: true, url: String(url || '') || null };
  try {
    await unlink(targetPath);
    await markMediaObjectDeleted({ db: prisma, url });
    return { deleted: true, skipped: false, url: String(url || '') || null };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { deleted: false, skipped: true, missing: true, url: String(url || '') || null };
    }
    throw error;
  }
}

export async function deleteChatUploads({ urls = [], userId }) {
  const uniqueUrls = [...new Set((Array.isArray(urls) ? urls : [urls]).map((item) => String(item || '').trim()).filter(Boolean))];
  let deletedCount = 0;
  const results = [];
  for (const url of uniqueUrls) {
    const result = await deleteChatUpload({ url, userId });
    if (result.deleted) deletedCount += 1;
    results.push(result);
  }
  return { deletedCount, results };
}

function parsePositiveInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.trunc(number);
  return rounded > 0 ? rounded : null;
}

function parseWaveform(value) {
  if (!value) return null;
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(String(value));
    if (!Array.isArray(parsed)) return null;
    const compact = parsed
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item))
      .slice(0, 256);
    return compact.length ? compact : null;
  } catch {
    return null;
  }
}

export function serializeChatMediaConfig(config = getChatMediaConfig()) {
  return {
    enabled: Boolean(config.enabled),
    storage: config.storage,
    base_path: config.basePath,
    object_base_path: config.objectBasePath,
    private_storage: Boolean(config.privateStorage),
    public_base_url: config.publicBaseUrl,
    strip_jpeg_exif: Boolean(config.stripJpegExif),
    previews: { ...config.previews },
    limits: Object.fromEntries(
      Object.entries(config.limits).map(([key, rule]) => [key, {
        max_bytes: rule.maxBytes,
        allowed_mime: [...rule.allowedMime],
        extensions: [...rule.extensions],
      }]),
    ),
  };
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

export async function storeChatUpload({ file, userId, kind, metadata = {} }) {
  const meta = metadata && typeof metadata === 'object' ? /** @type {any} */ (metadata) : {};
  const config = getChatMediaConfig();
  if (!config.enabled) {
    throw Object.assign(new Error('Загрузка файлов в чат сейчас отключена.'), { status: 503 });
  }
  assertChatLocalStorageAllowed(config);

  if (!(file instanceof File)) {
    throw Object.assign(new Error('Не найден файл для загрузки.'), { status: 400 });
  }

  const rawMime = String(file.type || '').trim().toLowerCase();
  const declaredMime = rawMime.split(';')[0].trim();
  const normalizedKind = normalizeType(kind) || inferTypeFromMime(declaredMime);
  const rule = config.limits[normalizedKind] || config.limits.file;
  const size = Number(file.size || 0);

  if (!size || size > rule.maxBytes) {
    throw Object.assign(new Error('Файл превышает допустимый размер для этого типа сообщения.'), { status: 400 });
  }

  await enforceMediaQuota({
    db: prisma,
    prefix: 'CHAT_MEDIA',
    ownerUserId: userId,
    surface: 'chat',
    scopeId: meta.conversationId || userId,
    bytes: size,
  });

  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const security = validateUploadSecurity({
    buffer: sourceBuffer,
    filename: file.name || 'file',
    mime: declaredMime,
    allowedMime: rule.allowedMime,
    allowedExtensions: rule.extensions,
    surface: 'chat',
  });
  const mime = security.mime;
  const originalName = security.originalName;
  const ext = inferExt(originalName, mime, rule.extensions);

  const now = new Date();
  const parts = buildChatParts(userId, meta);
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
    publicUrl = path.posix.join('/uploads/chat', ...parts, filename);
    if (config.previews?.enabled && shouldGeneratePreview(normalizedKind, mime)) {
      const previewBuffer = buildMediaPreviewSvg({ kind: normalizedKind, mime, originalName });
      const preview = await writeLocalPreview({ rootDir: ROOT_UPLOADS_DIR, basePath: '/uploads/chat', parts, filename, previewBuffer });
      thumbUrl = preview.thumbUrl;
      previewBytes = preview.previewBytes;
    }
  } else if (isObjectStorageMode(config.storage)) {
    storageKey = ['chat', ...parts, filename].join('/');
    const objectConfig = getObjectStorageConfig('CHAT_MEDIA');
    await putObject({ key: storageKey, body: buffer, contentType: mime, cacheControl: objectConfig.cacheControl, config: objectConfig });
    publicUrl = objectUrlForKey(storageKey);
    if (config.previews?.enabled && shouldGeneratePreview(normalizedKind, mime)) {
      const previewBuffer = buildMediaPreviewSvg({ kind: normalizedKind, mime, originalName });
      previewStorageKey = buildObjectPreviewKey({ rootPrefix: 'chat', parts, filename });
      const objectConfigForPreview = getObjectStorageConfig('CHAT_MEDIA');
      await putObject({ key: previewStorageKey, body: previewBuffer, contentType: MEDIA_PREVIEW_MIME, cacheControl: objectConfigForPreview.cacheControl, config: objectConfigForPreview });
      thumbUrl = objectUrlForKey(previewStorageKey);
      previewBytes = previewBuffer.length;
    }
  } else {
    throw Object.assign(new Error(`Неподдерживаемое chat media storage: ${config.storage}`), { status: 500 });
  }

  await recordMediaObject({
    db: prisma,
    ownerUserId: userId,
    surface: 'chat',
    scopeType: meta.conversationId ? 'conversation' : 'user',
    scopeId: meta.conversationId || userId,
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
    metadata: { originalName, exifStripped: stripped, private: isObjectStorageMode(config.storage) ? getObjectStorageConfig('CHAT_MEDIA').privateAccess : false },
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
    private: isObjectStorageMode(config.storage) ? getObjectStorageConfig('CHAT_MEDIA').privateAccess : false,
    mime,
    detectedMime: security.detectedMime,
    bytes: buffer.length,
    originalBytes: size,
    exifStripped: stripped,
    durationSec: parsePositiveInt(meta.durationSec || meta.duration || meta.durationSeconds),
    width: parsePositiveInt(meta.width),
    height: parsePositiveInt(meta.height),
    waveform: parseWaveform(meta.waveform),
    originalName,
  };
}

import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MB = 1024 * 1024;
const ROOT_PUBLIC_DIR = path.join(process.cwd(), 'public');
const ROOT_UPLOADS_DIR = path.join(ROOT_PUBLIC_DIR, 'uploads', 'chat');

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

function cloneRule(rule) {
  return {
    ...rule,
    allowedMime: [...rule.allowedMime],
    extensions: [...rule.extensions],
  };
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

  return {
    enabled: String(process.env.CHAT_MEDIA_ENABLED || 'true').trim().toLowerCase() !== 'false',
    storage: String(process.env.CHAT_MEDIA_STORAGE || 'local').trim().toLowerCase(),
    basePath: '/uploads/chat',
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


function resolveChatUploadPathFromUrl(url, userId) {
  const rawUrl = String(url || '').trim();
  if (!rawUrl.startsWith('/uploads/chat/')) return null;
  const relative = rawUrl.replace(/^\/uploads\/chat\//, '');
  const segments = relative.split('/').filter(Boolean);
  if (segments.length < 4) return null;
  if (String(segments[0]) !== String(userId)) return null;
  const targetPath = path.join(ROOT_UPLOADS_DIR, ...segments);
  const normalizedRoot = path.normalize(ROOT_UPLOADS_DIR + path.sep);
  const normalizedTarget = path.normalize(targetPath);
  if (!normalizedTarget.startsWith(normalizedRoot)) return null;
  return normalizedTarget;
}

export async function deleteChatUpload({ url, userId }) {
  const targetPath = resolveChatUploadPathFromUrl(url, userId);
  if (!targetPath) return { deleted: false, skipped: true, url: String(url || '') || null };
  try {
    await unlink(targetPath);
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
    limits: Object.fromEntries(
      Object.entries(config.limits).map(([key, rule]) => [key, {
        max_bytes: rule.maxBytes,
        allowed_mime: [...rule.allowedMime],
        extensions: [...rule.extensions],
      }]),
    ),
  };
}

export async function storeChatUpload({ file, userId, kind, metadata = {} }) {
  const meta = metadata && typeof metadata === 'object' ? /** @type {any} */ (metadata) : {};
  const config = getChatMediaConfig();
  if (!config.enabled) {
    throw Object.assign(new Error('Загрузка файлов в чат сейчас отключена.'), { status: 503 });
  }
  if (config.storage !== 'local') {
    throw Object.assign(new Error(`Неподдерживаемое chat media storage: ${config.storage}`), { status: 500 });
  }
  if (!(file instanceof File)) {
    throw Object.assign(new Error('Не найден файл для загрузки.'), { status: 400 });
  }

  const rawMime = String(file.type || '').trim().toLowerCase();
  const mime = rawMime.split(';')[0].trim();
  const normalizedKind = normalizeType(kind) || inferTypeFromMime(mime);
  const rule = config.limits[normalizedKind] || config.limits.file;
  const size = Number(file.size || 0);
  const originalName = cleanFilename(file.name || 'file');
  const ext = inferExt(originalName, mime, rule.extensions);

  if (!mime || !rule.allowedMime.includes(mime)) {
    throw Object.assign(new Error('Тип файла не поддерживается для сообщений в чате.'), { status: 400 });
  }
  if (!size || size > rule.maxBytes) {
    throw Object.assign(new Error('Файл превышает допустимый размер для этого типа сообщения.'), { status: 400 });
  }

  const now = new Date();
  const parts = [String(userId), String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0')];
  const targetDir = path.join(ROOT_UPLOADS_DIR, ...parts);
  await mkdir(targetDir, { recursive: true });

  const filename = `${now.getTime()}-${crypto.randomUUID()}${ext}`;
  const targetPath = path.join(targetDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(targetPath, buffer);

  const publicUrl = path.posix.join('/uploads/chat', ...parts, filename);

  return {
    kind: normalizedKind,
    url: publicUrl,
    thumbUrl: normalizedKind === 'image' ? publicUrl : null,
    mime,
    bytes: size,
    durationSec: parsePositiveInt(meta.durationSec || meta.duration || meta.durationSeconds),
    width: parsePositiveInt(meta.width),
    height: parsePositiveInt(meta.height),
    waveform: parseWaveform(meta.waveform),
    originalName,
  };
}

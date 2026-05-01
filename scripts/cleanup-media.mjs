import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { deleteObject, getObjectStorageConfig, getObjectStorageKeyFromPublicUrl, listObjects } from '../lib/object-storage.js';

const root = process.cwd();
const prisma = new PrismaClient();
const shouldDelete = process.argv.includes('--delete');
const scanObjectStorage = process.argv.includes('--object') || process.argv.includes('--objects');
const staleStoryHours = Number(process.env.STORY_MEDIA_CLEANUP_STALE_HOURS || 72);
const staleStoryMs = Math.max(24, Number.isFinite(staleStoryHours) ? staleStoryHours : 72) * 60 * 60 * 1000;

const AREAS = [
  { name: 'community', urlPrefix: '/uploads/communities/', localRoot: path.join(root, 'public', 'uploads', 'communities'), objectRoot: 'communities', configPrefix: 'COMMUNITY_MEDIA', story: false },
  { name: 'post', urlPrefix: '/uploads/posts/', localRoot: path.join(root, 'public', 'uploads', 'posts'), objectRoot: 'posts', configPrefix: 'POST_MEDIA', story: false },
  { name: 'chat', urlPrefix: '/uploads/chat/', localRoot: path.join(root, 'public', 'uploads', 'chat'), objectRoot: 'chat', configPrefix: 'CHAT_MEDIA', story: false },
  { name: 'story', urlPrefix: '/uploads/stories/', localRoot: path.join(root, 'public', 'uploads', 'stories'), objectRoot: 'stories', configPrefix: 'STORY_MEDIA', story: true },
];

const URL_KEYS = new Set(['url', 'mediaUrl', 'media_url', 'thumbUrl', 'thumb_url', 'thumbnail', 'thumbnailUrl', 'previewUrl', 'preview_url', 'coverUrl', 'cover_url', 'avatarUrl', 'avatar_url', 'imageUrl', 'image_url']);
const KEY_KEYS = new Set(['storageKey', 'storage_key', 'previewStorageKey', 'preview_storage_key']);

function normalizeStorageKey(key = '') {
  return String(key || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).join('/');
}

function internalObjectKeyFromUrl(url = '') {
  const raw = String(url || '').trim();
  for (const area of AREAS) {
    const prefix = `/api/storage/${area.name}/`;
    if (raw.startsWith(prefix)) return decodeURIComponent(raw.slice(prefix.length)).replace(/^\/+|\/+$/g, '');
  }
  return null;
}

function collectFromJson(value, refs) {
  if (!value) return;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (raw.startsWith('/uploads/') || raw.startsWith('/api/storage/')) refs.urls.add(raw);
    const internalKey = internalObjectKeyFromUrl(raw);
    if (internalKey) refs.objectKeys.add(internalKey);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFromJson(item, refs);
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (URL_KEYS.has(key) && typeof item === 'string') refs.urls.add(item.trim());
    if (KEY_KEYS.has(key) && typeof item === 'string') {
      const normalized = normalizeStorageKey(item);
      if (normalized) refs.objectKeys.add(normalized);
    }
    collectFromJson(item, refs);
  }
}

function localPathFromUrl(url, area) {
  const raw = String(url || '').trim();
  if (!raw.startsWith(area.urlPrefix)) return null;
  const relative = raw.slice(area.urlPrefix.length);
  const target = path.join(area.localRoot, ...relative.split('/').filter(Boolean));
  const normalizedRoot = path.normalize(area.localRoot + path.sep);
  const normalizedTarget = path.normalize(target);
  return normalizedTarget.startsWith(normalizedRoot) ? normalizedTarget : null;
}

async function walkFiles(dir) {
  const files = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function collectReferences() {
  const refs = { urls: new Set(), objectKeys: new Set() };

  const communities = await prisma.community.findMany({ select: { avatarUrl: true, coverUrl: true } }).catch(() => []);
  for (const community of communities) collectFromJson(community, refs);

  const posts = await prisma.post.findMany({ select: { payload: true } }).catch(() => []);
  for (const post of posts) collectFromJson(post.payload, refs);

  const messages = await prisma.chatMessage.findMany({
    select: { mediaUrl: true, mediaThumbUrl: true, metadata: true },
  }).catch(() => []);
  for (const message of messages) collectFromJson(message, refs);

  const trackedMedia = prisma.mediaObject?.findMany
    ? await prisma.mediaObject.findMany({
      where: { status: 'active' },
      select: { url: true, thumbUrl: true, storageKey: true, previewStorageKey: true },
    }).catch(() => [])
    : [];
  for (const item of trackedMedia) collectFromJson(item, refs);

  for (const url of [...refs.urls]) {
    const internalKey = internalObjectKeyFromUrl(url);
    if (internalKey) refs.objectKeys.add(internalKey);
    for (const area of AREAS) {
      const config = getObjectStorageConfig(area.configPrefix);
      const key = getObjectStorageKeyFromPublicUrl(url, config);
      if (key) refs.objectKeys.add(key);
    }
  }

  return refs;
}

async function deleteLocalFiles(files) {
  let deleted = 0;
  for (const file of files) {
    await fs.unlink(file).then(() => { deleted += 1; }).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
  return deleted;
}

async function scanLocal(area, referencedPaths) {
  const files = await walkFiles(area.localRoot);
  const now = Date.now();
  const unused = [];
  for (const file of files) {
    const normalized = path.normalize(file);
    if (area.story) {
      const stat = await fs.stat(file).catch(() => null);
      if (stat && now - stat.mtimeMs > staleStoryMs) unused.push(file);
      continue;
    }
    if (!referencedPaths.has(normalized)) unused.push(file);
  }
  const deleted = shouldDelete ? await deleteLocalFiles(unused) : 0;
  return {
    scanned: files.length,
    unused: unused.length,
    deleted,
    sample: unused.map((file) => path.relative(root, file)).slice(0, 80),
  };
}

function isObjectStaleStory(item) {
  if (!item?.lastModified) return false;
  const stamp = new Date(item.lastModified).getTime();
  return Number.isFinite(stamp) && Date.now() - stamp > staleStoryMs;
}

async function scanObjects(area, referencedKeys) {
  const config = getObjectStorageConfig(area.configPrefix);
  if (!config.enabled || !scanObjectStorage) return { enabled: config.enabled, scanned: 0, unused: 0, deleted: 0, skipped: !scanObjectStorage };
  const objects = await listObjects({ prefix: area.objectRoot, config }).catch((error) => {
    console.error(`[cleanup-media] object scan failed for ${area.name}:`, error?.message || error);
    return [];
  });
  const unused = objects.filter((item) => {
    const key = normalizeStorageKey(item.key);
    if (!key) return false;
    if (area.story) return isObjectStaleStory(item);
    return !referencedKeys.has(key);
  });
  let deleted = 0;
  if (shouldDelete) {
    for (const item of unused) {
      const key = normalizeStorageKey(item.key);
      const result = await deleteObject({ key, config }).catch((error) => ({ error: error?.message || String(error) }));
      if (result?.deleted) deleted += 1;
    }
  }
  return {
    enabled: config.enabled,
    scanned: objects.length,
    unused: unused.length,
    deleted,
    sample: unused.map((item) => item.key).slice(0, 80),
  };
}

async function main() {
  const refs = await collectReferences();
  const referencedPaths = new Set();
  for (const url of refs.urls) {
    for (const area of AREAS) {
      const localPath = localPathFromUrl(url, area);
      if (localPath) referencedPaths.add(path.normalize(localPath));
    }
  }

  const summary = {
    mode: shouldDelete ? 'delete' : 'dry-run',
    object_storage_scan: scanObjectStorage,
    story_stale_hours: Math.round(staleStoryMs / 60 / 60 / 1000),
    references: {
      urls: refs.urls.size,
      object_keys: refs.objectKeys.size,
      local_files: referencedPaths.size,
      media_object_model: Boolean(prisma.mediaObject),
    },
    areas: {},
  };

  for (const area of AREAS) {
    summary.areas[area.name] = {
      local: await scanLocal(area, referencedPaths),
      object: await scanObjects(area, refs.objectKeys),
    };
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error('[cleanup-media] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });

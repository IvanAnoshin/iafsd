import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];

function read(rel) {
  return fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '';
}
function requireFile(rel) {
  if (!fs.existsSync(path.join(root, rel))) errors.push(`missing file: ${rel}`);
}
function requireText(rel, pattern, label) {
  const text = read(rel);
  if (!pattern.test(text)) errors.push(`${rel} missing ${label}`);
}

requireFile('lib/media-security.js');
requireText('lib/media-security.js', /sniffMime/, 'MIME sniffing');
requireText('lib/media-security.js', /DANGEROUS_EXTENSIONS/, 'dangerous extension policy');
requireText('lib/media-security.js', /enforceMediaQuota/, 'quota enforcement');
requireText('prisma/schema.prisma', /model\s+MediaObject\s+\{/, 'MediaObject model');
requireFile('prisma/migrations/20260426_storage_production_hardening/migration.sql');

for (const rel of ['lib/chat-media.js', 'lib/post-media.js', 'lib/community-media.js', 'lib/story-media.js']) {
  requireText(rel, /validateUploadSecurity/, 'upload validation');
  requireText(rel, /enforceMediaQuota/, 'quota check');
  requireText(rel, /recordMediaObject/, 'media object tracking');
}

for (const rel of [
  'app/api/storage/chat/[...key]/route.js',
  'app/api/storage/post/[...key]/route.js',
  'app/api/storage/community/[...key]/route.js',
  'app/api/storage/story/[...key]/route.js',
]) {
  requireText(rel, /getStorageProxyHeaders/, 'private storage proxy headers');
  requireText(rel, /createPresignedGetUrl/, 'signed read url');
}

for (const rel of [
  'app/api/chat/media/upload/route.js',
  'app/api/profile/media/upload/route.js',
  'app/api/communities/[slug]/media/upload/route.js',
  'app/api/stories/media/upload/route.js',
]) {
  const text = read(rel);
  if (/storageKey:\s*upload\.storageKey|storage_key:\s*upload\.storageKey|previewStorageKey:\s*upload\.previewStorageKey|preview_storage_key:\s*upload\.previewStorageKey/.test(text)) {
    errors.push(`${rel} leaks raw storage keys to clients`);
  }
}

for (const rel of ['.env.example', '.env.production.example']) {
  requireText(rel, /STORAGE_USER_DAILY_BYTES=/, 'global media user quota');
  requireText(rel, /STORAGE_SCOPE_DAILY_BYTES=/, 'global media scope quota');
  requireText(rel, /CHAT_MEDIA_USER_DAILY_BYTES=/, 'chat quota');
  requireText(rel, /POST_MEDIA_USER_DAILY_BYTES=/, 'post quota');
  requireText(rel, /COMMUNITY_MEDIA_USER_DAILY_BYTES=/, 'community quota');
  requireText(rel, /STORY_MEDIA_USER_DAILY_BYTES=/, 'story quota');
}

const prodEnv = read('.env.production.example');
if (/POST_MEDIA_PRIVATE=false|COMMUNITY_MEDIA_PRIVATE=false|STORY_MEDIA_PRIVATE=false|STORAGE_PRIVATE=false/.test(prodEnv)) {
  warnings.push('production env has public media storage; verify this is deliberate');
}

const summary = {
  checked_at: new Date().toISOString(),
  status: errors.length ? 'error' : warnings.length ? 'warn' : 'ready',
  warnings,
  errors,
};
console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exit(1);

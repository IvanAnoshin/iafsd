import fs from 'node:fs';
import path from 'node:path';

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function loadEnvFile(file) {
  if (!file) return;
  const fullPath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(fullPath)) return;
  const text = fs.readFileSync(fullPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

loadEnvFile(argValue('env-file', process.env.FRIENDSCAPE_ENV_FILE || ''));

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);
const OBJECT_STORAGE_VALUES = new Set(['s3', 'r2', 'yandex', 'object', 's3-compatible', 'cloudflare-r2', 'yandex-s3', 'yc']);
const LOCAL_STORAGE_VALUES = new Set(['local', 'filesystem', 'fs']);

const errors = [];
const warnings = [];
const env = process.env;
const isProduction = env.NODE_ENV === 'production';
const allowedAppEnvs = new Set(['development', 'local', 'test', 'staging', 'production']);

function read(key, fallback = '') {
  const value = env[key];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim();
}

function boolValue(key, fallback = false) {
  const value = read(key);
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  errors.push(`${key} must be boolean-like: true/false/1/0/yes/no/on/off.`);
  return fallback;
}

function requireVar(key) {
  if (!read(key)) errors.push(`Missing required variable: ${key}`);
}

function requirePositiveInteger(key) {
  const raw = read(key);
  if (!raw) return;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    errors.push(`${key} must be a positive integer when set.`);
  }
}

function validateUrl(key, { required = false, httpsInProduction = false } = {}) {
  const value = read(key);
  if (!value) {
    if (required) errors.push(`Missing required variable: ${key}`);
    return null;
  }

  try {
    const parsed = new URL(value);
    if (httpsInProduction && isProduction && parsed.protocol !== 'https:') {
      errors.push(`${key} must use https:// in production.`);
    }
    return parsed;
  } catch {
    errors.push(`${key} must be a valid absolute URL.`);
    return null;
  }
}

function validateSameSite() {
  const sameSite = read('SESSION_COOKIE_SAME_SITE', 'lax').toLowerCase();
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    errors.push('SESSION_COOKIE_SAME_SITE must be one of: lax, strict, none.');
  }
  if (sameSite === 'none' && !boolValue('SESSION_COOKIE_SECURE', isProduction)) {
    errors.push('SESSION_COOKIE_SAME_SITE=none requires SESSION_COOKIE_SECURE=true.');
  }
}

function requireStorageCredentials(prefix) {
  const missing = [`${prefix}_ENDPOINT`, `${prefix}_BUCKET`, `${prefix}_ACCESS_KEY_ID`, `${prefix}_SECRET_ACCESS_KEY`]
    .filter((key) => !read(key));
  if (missing.length) errors.push(`Missing ${prefix} object storage variables: ${missing.join(', ')}.`);
}

function validateStorage(prefix, { privateDefault = false } = {}) {
  const enabled = boolValue(`${prefix}_ENABLED`, true);
  const storage = read(`${prefix}_STORAGE`, read('STORAGE_PROVIDER', 'local')).toLowerCase();

  if (!enabled) return;

  if (!LOCAL_STORAGE_VALUES.has(storage) && !OBJECT_STORAGE_VALUES.has(storage)) {
    errors.push(`${prefix}_STORAGE must be local, s3, r2, yandex, object, or s3-compatible.`);
    return;
  }

  if (OBJECT_STORAGE_VALUES.has(storage)) {
    const missingSpecific = [`${prefix}_ENDPOINT`, `${prefix}_BUCKET`, `${prefix}_ACCESS_KEY_ID`, `${prefix}_SECRET_ACCESS_KEY`]
      .filter((key) => !read(key));
    const hasShared = read('STORAGE_ENDPOINT') && read('STORAGE_BUCKET') && read('STORAGE_ACCESS_KEY_ID') && read('STORAGE_SECRET_ACCESS_KEY');
    if (missingSpecific.length && !hasShared) {
      errors.push(`Missing ${prefix} object storage variables or shared STORAGE_* variables: ${missingSpecific.join(', ')}.`);
    }
  }

  if (isProduction && LOCAL_STORAGE_VALUES.has(storage)) {
    const allowLocal = boolValue(`${prefix}_ALLOW_LOCAL_IN_PRODUCTION`, false);
    if (!allowLocal) {
      errors.push(`${prefix}_STORAGE=local is blocked in production unless ${prefix}_ALLOW_LOCAL_IN_PRODUCTION=true is set explicitly.`);
    } else {
      warnings.push(`${prefix}_STORAGE=local is enabled in production. Keep it only for a single-server deployment with backed-up public/uploads.`);
    }
  }

  if (isProduction && privateDefault && !boolValue(`${prefix}_PRIVATE`, true)) {
    warnings.push(`${prefix}_PRIVATE=false in production. Verify that access checks happen before issuing media URLs.`);
  }
}

function printResult() {
  const payload = {
    status: errors.length ? 'error' : warnings.length ? 'warn' : 'ok',
    node_env: env.NODE_ENV || 'development',
    warnings,
    errors,
  };

  console.log(JSON.stringify(payload, null, 2));
  if (errors.length) process.exit(1);
}

requireVar('DATABASE_URL');
validateUrl('APP_PUBLIC_URL', { required: true, httpsInProduction: true });

const appEnv = read('APP_ENV', isProduction ? 'production' : 'development').toLowerCase();
if (!allowedAppEnvs.has(appEnv)) {
  errors.push('APP_ENV must be one of: development, local, test, staging, production.');
}
if (isProduction && appEnv === 'development') {
  errors.push('APP_ENV=development is not allowed with NODE_ENV=production. Use APP_ENV=staging or APP_ENV=production.');
}
if (appEnv === 'staging' && read('APP_PUBLIC_URL') && !/staging/i.test(read('APP_PUBLIC_URL'))) {
  warnings.push('APP_ENV=staging but APP_PUBLIC_URL does not look like a staging domain.');
}
if (appEnv === 'production' && read('APP_PUBLIC_URL') && /staging/i.test(read('APP_PUBLIC_URL'))) {
  errors.push('APP_ENV=production must not use a staging APP_PUBLIC_URL.');
}

for (const key of ['RELEASE_REQUIRE_CLEAN_GIT', 'RELEASE_BACKUP_BEFORE_MIGRATE', 'RELEASE_SMOKE_AFTER_DEPLOY']) {
  boolValue(key, key === 'RELEASE_REQUIRE_CLEAN_GIT' ? isProduction : false);
}

validateSameSite();

if (isProduction && !boolValue('SESSION_COOKIE_SECURE', true)) {
  errors.push('SESSION_COOKIE_SECURE must be true in production.');
}

const csrfTrustedOrigins = read('CSRF_TRUSTED_ORIGINS');
if (isProduction && !csrfTrustedOrigins) {
  warnings.push('CSRF_TRUSTED_ORIGINS is empty. Add APP_PUBLIC_URL and any reverse-proxy public origins if they differ.');
}

const appPublicUrl = read('APP_PUBLIC_URL');
const passkeyRpId = read('PASSKEY_RP_ID');
const passkeyOrigin = read('PASSKEY_ORIGIN');
if (isProduction) {
  if (!passkeyRpId) warnings.push('PASSKEY_RP_ID is empty. The app will derive it from APP_PUBLIC_URL, but explicit production config is safer.');
  if (!passkeyOrigin) warnings.push('PASSKEY_ORIGIN is empty. The app will derive it from APP_PUBLIC_URL, but explicit production config is safer.');
  if (passkeyOrigin && appPublicUrl) {
    try {
      if (new URL(passkeyOrigin).origin !== new URL(appPublicUrl).origin) {
        warnings.push('PASSKEY_ORIGIN differs from APP_PUBLIC_URL origin. This is valid only for a deliberate multi-origin setup.');
      }
    } catch {}
  }
}

[
  'RECOVERY_SESSION_TTL_MINUTES',
  'DEVICE_TRUST_AFTER_SESSIONS',
  'STORAGE_USER_DAILY_BYTES',
  'STORAGE_SCOPE_DAILY_BYTES',
  'CHAT_MEDIA_USER_DAILY_BYTES',
  'CHAT_MEDIA_SCOPE_DAILY_BYTES',
  'POST_MEDIA_USER_DAILY_BYTES',
  'POST_MEDIA_SCOPE_DAILY_BYTES',
  'COMMUNITY_MEDIA_USER_DAILY_BYTES',
  'COMMUNITY_MEDIA_SCOPE_DAILY_BYTES',
  'STORY_MEDIA_USER_DAILY_BYTES',
  'STORY_MEDIA_SCOPE_DAILY_BYTES',
  'CHAT_MEDIA_IMAGE_MAX_BYTES',
  'CHAT_MEDIA_VIDEO_MAX_BYTES',
  'CHAT_MEDIA_FILE_MAX_BYTES',
  'CHAT_MEDIA_VOICE_MAX_BYTES',
  'CHAT_MEDIA_VIDEO_NOTE_MAX_BYTES',
  'CHAT_RATE_LIMIT_CONVERSATION_WINDOW_MS',
  'CHAT_RATE_LIMIT_CONVERSATION_BURST',
  'CHAT_RATE_LIMIT_GLOBAL_WINDOW_MS',
  'CHAT_RATE_LIMIT_GLOBAL_BURST',
  'CHAT_RATE_LIMIT_DUPLICATE_WINDOW_MS',
  'CHAT_RATE_LIMIT_DUPLICATE_BURST',
  'CHAT_SAFETY_FLAG_DEDUPE_WINDOW_MS',
  'CHAT_SAFETY_REPORT_WINDOW_MS',
  'COMMUNITY_MEDIA_IMAGE_MAX_BYTES',
  'COMMUNITY_MEDIA_VIDEO_MAX_BYTES',
  'COMMUNITY_MEDIA_SIGNED_READ_TTL_SECONDS',
  'POST_MEDIA_IMAGE_MAX_BYTES',
  'POST_MEDIA_VIDEO_MAX_BYTES',
  'POST_MEDIA_SIGNED_READ_TTL_SECONDS',
  'STORY_MEDIA_IMAGE_MAX_BYTES',
  'STORY_MEDIA_VIDEO_MAX_BYTES',
  'STORY_MEDIA_SIGNED_READ_TTL_SECONDS',
  'STORY_MEDIA_CLEANUP_STALE_HOURS',
  'RATE_LIMIT_CLEANUP_OLDER_THAN_HOURS',
  'BACKUP_RETENTION_DAYS',
  'NOTIFICATION_CLEANUP_READ_DAYS',
  'ABUSE_EVENT_CLEANUP_DAYS',
  'AUDIT_LOG_CLEANUP_DAYS',
  'DFSN_SESSION_CLEANUP_DAYS',
  'CHAT_DRAFT_CLEANUP_DAYS',
  'REALTIME_HISTORY_LIMIT',
  'REALTIME_EVENT_RETENTION_DAYS',
].forEach(requirePositiveInteger);

const trustSessions = Number(read('DEVICE_TRUST_AFTER_SESSIONS', '3'));
if (Number.isFinite(trustSessions) && trustSessions < 3) {
  warnings.push('DEVICE_TRUST_AFTER_SESSIONS is below the project default of 3.');
}

validateStorage('CHAT_MEDIA', { privateDefault: true });
validateStorage('COMMUNITY_MEDIA', { privateDefault: true });
validateStorage('POST_MEDIA', { privateDefault: true });
validateStorage('STORY_MEDIA', { privateDefault: true });

if (isProduction && boolValue('RATE_LIMIT_MEMORY_FALLBACK_IN_PRODUCTION', false)) {
  warnings.push('RATE_LIMIT_MEMORY_FALLBACK_IN_PRODUCTION=true is unsafe for multi-instance production.');
}

const realtimeTransport = read('REALTIME_TRANSPORT', isProduction ? 'postgres' : 'memory').toLowerCase();
if (!['memory', 'local', 'in-memory', 'process', 'postgres', 'pg', 'db', 'database'].includes(realtimeTransport)) {
  errors.push('REALTIME_TRANSPORT must be memory or postgres.');
}
if (isProduction && ['memory', 'local', 'in-memory', 'process'].includes(realtimeTransport) && !boolValue('REALTIME_ALLOW_MEMORY_IN_PRODUCTION', false)) {
  errors.push('REALTIME_TRANSPORT=memory is blocked in production unless REALTIME_ALLOW_MEMORY_IN_PRODUCTION=true is set explicitly. Use REALTIME_TRANSPORT=postgres for multi-process deployments.');
}
if (read('REALTIME_PG_CHANNEL') && !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(read('REALTIME_PG_CHANNEL'))) {
  errors.push('REALTIME_PG_CHANNEL must be a valid PostgreSQL identifier up to 63 chars.');
}

printResult();

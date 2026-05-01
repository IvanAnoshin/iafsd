const required = ['DATABASE_URL', 'APP_PUBLIC_URL'];
const missing = required.filter((key) => !String(process.env[key] || '').trim());

if (missing.length) {
  console.error(`[env] Missing required variables: ${missing.join(', ')}`);
  process.exit(1);
}

let publicUrl;
try {
  publicUrl = new URL(process.env.APP_PUBLIC_URL);
} catch {
  console.error('[env] APP_PUBLIC_URL must be a valid absolute URL.');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production' && publicUrl.protocol !== 'https:') {
  console.error('[env] APP_PUBLIC_URL must use https in production.');
  process.exit(1);
}

const sameSite = String(process.env.SESSION_COOKIE_SAME_SITE || 'lax').toLowerCase();
if (!['lax', 'strict', 'none'].includes(sameSite)) {
  console.error('[env] SESSION_COOKIE_SAME_SITE must be one of: lax, strict, none');
  process.exit(1);
}

const positiveIntegerVars = [
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
];

for (const key of positiveIntegerVars) {
  const raw = String(process.env[key] || '').trim();
  if (!raw) continue;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    console.error(`[env] ${key} must be a positive integer when set.`);
    process.exit(1);
  }
}

if (process.env.NODE_ENV === 'production') {
  const secureCookie = String(process.env.SESSION_COOKIE_SECURE || 'true').toLowerCase();
  if (secureCookie !== 'true') {
    console.error('[env] SESSION_COOKIE_SECURE must be true in production.');
    process.exit(1);
  }
}

console.log('[env] Environment looks good.');

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const args = new Map();
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--') && arg.includes('=')) {
    const [key, ...parts] = arg.slice(2).split('=');
    args.set(key, parts.join('='));
  } else if (arg.startsWith('--')) {
    args.set(arg.slice(2), 'true');
  }
}

const target = (args.get('target') || process.env.RELEASE_TARGET || process.env.APP_ENV || 'staging').toLowerCase();
const envFile = args.get('env-file') || process.env.FRIENDSCAPE_ENV_FILE || (target === 'production' ? '.env.production' : '.env.staging');
const strict = TRUE_VALUES.has(String(args.get('strict') || process.env.RELEASE_STRICT || '').toLowerCase());
const root = process.cwd();
const errors = [];
const warnings = [];
const checks = [];

function ok(name, detail) { checks.push({ name, status: 'ok', detail }); }
function warn(name, detail) { warnings.push(`${name}: ${detail}`); checks.push({ name, status: 'warn', detail }); }
function fail(name, detail) { errors.push(`${name}: ${detail}`); checks.push({ name, status: 'error', detail }); }
function readFileMaybe(file) { try { return fs.readFileSync(path.isAbsolute(file) ? file : path.join(root, file), 'utf8'); } catch { return ''; } }
function loadEnvText(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}
function isTruthy(value) { return TRUE_VALUES.has(String(value || '').toLowerCase()); }
function hasPlaceholder(value) { return /CHANGE_ME|example\.com|ChangeThis|v0\.0\.0/.test(String(value || '')); }
function scriptExists(name) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return Boolean(pkg.scripts?.[name]);
}

const envText = readFileMaybe(envFile);
if (!envText) fail('env_file', `${envFile} not found`);
else ok('env_file', envFile);
const env = { ...process.env, ...loadEnvText(envText) };

if (!['staging', 'production'].includes(target)) fail('target', 'must be staging or production');
else ok('target', target);

if (env.NODE_ENV !== 'production') fail('NODE_ENV', 'release targets must run with NODE_ENV=production');
else ok('NODE_ENV', 'production');

if ((env.APP_ENV || '').toLowerCase() !== target) fail('APP_ENV', `expected ${target}, got ${env.APP_ENV || '(empty)'}`);
else ok('APP_ENV', target);

for (const key of ['DATABASE_URL', 'APP_PUBLIC_URL', 'SESSION_COOKIE_SECURE', 'CSRF_TRUSTED_ORIGINS', 'PASSKEY_RP_ID', 'PASSKEY_ORIGIN', 'REALTIME_TRANSPORT', 'BACKUP_DIR']) {
  env[key] ? ok(`env:${key}`, 'set') : fail(`env:${key}`, 'missing');
}

if (env.APP_PUBLIC_URL) {
  try {
    const url = new URL(env.APP_PUBLIC_URL);
    if (url.protocol !== 'https:') fail('APP_PUBLIC_URL', 'must use https for staging/production');
    else ok('APP_PUBLIC_URL:https', url.origin);
    if (target === 'staging' && !/staging/i.test(url.hostname)) warn('APP_PUBLIC_URL:staging_name', 'hostname does not contain staging');
  } catch { fail('APP_PUBLIC_URL', 'invalid URL'); }
}

if (target === 'production' && /staging/i.test(String(env.DATABASE_URL))) fail('database_scope', 'production DATABASE_URL looks like staging');
if (target === 'staging' && /prod/i.test(String(env.STORAGE_BUCKET || ''))) warn('storage_scope', 'staging storage bucket looks production-like');
if (String(env.REALTIME_TRANSPORT || '').toLowerCase() !== 'postgres') fail('REALTIME_TRANSPORT', 'use postgres before release');
if (env.MEDIA_REFERENCE_STRICT !== 'true') warn('MEDIA_REFERENCE_STRICT', 'set true explicitly for release');

const placeholders = Object.entries(env)
  .filter(([key]) => /URL|ORIGIN|ID|SECRET|KEY|PASSWORD|BUCKET|TAG|BASE_URL|DATABASE/.test(key))
  .filter(([, value]) => hasPlaceholder(value))
  .map(([key]) => key);
if (placeholders.length) {
  const message = `placeholder values detected: ${placeholders.slice(0, 16).join(', ')}${placeholders.length > 16 ? ` (+${placeholders.length - 16})` : ''}`;
  strict ? fail('placeholders', message) : warn('placeholders', message);
} else ok('placeholders', 'none detected');

for (const name of ['backup:db', 'deploy:migrate', 'build:prod', 'start:prod', 'verify:launch', 'smoke:e2e', 'monitor:alerts', 'rollback:check']) {
  scriptExists(name) ? ok(`script:${name}`, 'present') : fail(`script:${name}`, 'missing');
}

if (isTruthy(env.RELEASE_BACKUP_BEFORE_MIGRATE)) ok('release_backup_gate', 'backup is required before migrate');
else warn('release_backup_gate', 'RELEASE_BACKUP_BEFORE_MIGRATE is not enabled');
if (isTruthy(env.RELEASE_SMOKE_AFTER_DEPLOY)) ok('release_smoke_gate', 'smoke is required after deploy');
else warn('release_smoke_gate', 'RELEASE_SMOKE_AFTER_DEPLOY is not enabled');

if (isTruthy(env.RELEASE_REQUIRE_CLEAN_GIT)) {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (result.status === 0) {
    const dirty = result.stdout.trim();
    dirty ? (strict ? fail('git_clean', 'working tree has uncommitted changes') : warn('git_clean', 'working tree has uncommitted changes')) : ok('git_clean', 'clean');
  } else {
    warn('git_clean', 'git status unavailable; skip in archive builds');
  }
}

const commands = [
  `set -a && . ${envFile} && set +a`,
  'NODE_ENV=production npm run check:env',
  'NODE_ENV=production npm run release:check',
  'NODE_ENV=production npm run backup:db',
  'NODE_ENV=production npm run build:prod',
  'NODE_ENV=production npm run deploy:migrate',
  'sudo systemctl restart friendscape-next',
  'curl -fsS "$APP_PUBLIC_URL/api/health"',
  'curl -fsS "$APP_PUBLIC_URL/api/version"',
  'NODE_ENV=production npm run smoke:e2e',
  'NODE_ENV=production npm run monitor:alerts',
];

const summary = {
  checked_at: new Date().toISOString(),
  target,
  env_file: envFile,
  strict,
  status: errors.length ? 'error' : warnings.length ? 'warn' : 'ready',
  checks,
  warnings,
  errors,
  recommended_commands: commands,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exit(1);

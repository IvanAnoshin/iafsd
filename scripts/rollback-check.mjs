import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];
const checks = [];
const args = new Map();
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--') && arg.includes('=')) {
    const [key, ...parts] = arg.slice(2).split('=');
    args.set(key, parts.join('='));
  } else if (arg.startsWith('--')) args.set(arg.slice(2), 'true');
}
const envFile = args.get('env-file') || process.env.FRIENDSCAPE_ENV_FILE || '.env.production';
const strict = ['1', 'true', 'yes', 'on'].includes(String(args.get('strict') || '').toLowerCase());

function ok(name, detail) { checks.push({ name, status: 'ok', detail }); }
function warn(name, detail) { warnings.push(`${name}: ${detail}`); checks.push({ name, status: 'warn', detail }); }
function fail(name, detail) { errors.push(`${name}: ${detail}`); checks.push({ name, status: 'error', detail }); }
function exists(file) { return fs.existsSync(path.join(root, file)); }
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function loadEnv(file) {
  const full = path.isAbsolute(file) ? file : path.join(root, file);
  if (!fs.existsSync(full)) return {};
  const out = {};
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
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

for (const file of ['docs/ROLLBACK_RUNBOOK.md', 'docs/RELEASE_RUNBOOK.md', 'scripts/restore-db.mjs', 'scripts/backup-db.mjs', 'scripts/verify-launch.mjs']) {
  exists(file) ? ok(`file:${file}`, 'present') : fail(`file:${file}`, 'missing');
}
const pkg = JSON.parse(read('package.json'));
for (const script of ['restore:db', 'backup:db', 'deploy:migrate', 'start:prod', 'verify:launch', 'monitor:alerts']) {
  pkg.scripts?.[script] ? ok(`script:${script}`, 'present') : fail(`script:${script}`, 'missing');
}

const env = { ...process.env, ...loadEnv(envFile) };
if (Object.keys(env).length === Object.keys(process.env).length) warn('env_file', `${envFile} not found; using process env only`);
else ok('env_file', envFile);
for (const key of ['BACKUP_DIR', 'DATABASE_URL', 'APP_PUBLIC_URL']) {
  env[key] ? ok(`env:${key}`, 'set') : (strict ? fail(`env:${key}`, 'missing') : warn(`env:${key}`, 'missing'));
}
if (env.BACKUP_DIR && fs.existsSync(env.BACKUP_DIR)) {
  const dumps = fs.readdirSync(env.BACKUP_DIR).filter((name) => /\.(dump|sql)(\.gz)?$/.test(name)).sort();
  dumps.length ? ok('backup_files', `${dumps.length} backup candidate(s)`) : warn('backup_files', `no backup files found in ${env.BACKUP_DIR}`);
} else if (env.BACKUP_DIR) {
  warn('backup_dir', `${env.BACKUP_DIR} does not exist in this environment`);
}

const rollbackCommands = [
  'sudo systemctl stop friendscape-next',
  'git checkout <previous_release_tag_or_commit>',
  'npm ci',
  'set -a && . ./.env.production && set +a',
  'NODE_ENV=production npm run check:env',
  'NODE_ENV=production npm run build:prod',
  'NODE_ENV=production npm run restore:db -- --file=/var/backups/friendscape/db/<backup.dump> --yes',
  'sudo systemctl start friendscape-next',
  'curl -fsS "$APP_PUBLIC_URL/api/health"',
  'NODE_ENV=production npm run verify:launch',
  'NODE_ENV=production npm run monitor:alerts',
];

const summary = {
  checked_at: new Date().toISOString(),
  env_file: envFile,
  strict,
  status: errors.length ? 'error' : warnings.length ? 'warn' : 'ready',
  checks,
  warnings,
  errors,
  rollback_commands: rollbackCommands,
};
console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exit(1);

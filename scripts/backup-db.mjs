import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const args = new Set(process.argv.slice(2));

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function intEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

async function loadEnvFile(file) {
  if (!file) return;
  const fullPath = path.isAbsolute(file) ? file : path.join(root, file);
  const text = await fs.readFile(fullPath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupName() {
  const prefix = String(process.env.BACKUP_NAME_PREFIX || 'friendscape-db').replace(/[^a-zA-Z0-9._-]+/g, '-');
  return `${prefix}-${timestamp()}.dump`;
}

function maskUrl(url = '') {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    if (parsed.username) parsed.username = '***';
    return parsed.toString();
  } catch {
    return '<DATABASE_URL>';
  }
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function pruneOldBackups(dir, retentionDays, dryRun) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const removed = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.dump') && !entry.name.endsWith('.sql')) continue;
    const full = path.join(dir, entry.name);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat || stat.mtimeMs >= cutoff) continue;
    removed.push(entry.name);
    if (!dryRun) await fs.unlink(full).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
  return removed;
}

async function main() {
  await loadEnvFile(argValue('env-file', process.env.FRIENDSCAPE_ENV_FILE || '.env.production'));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for database backup.');

  const dryRun = args.has('--dry-run');
  const shouldPrune = args.has('--prune') || boolEnv('BACKUP_PRUNE_AFTER_SUCCESS', false);
  const retentionDays = intEnv('BACKUP_RETENTION_DAYS', 14);
  const backupDir = path.resolve(root, argValue('dir', process.env.BACKUP_DIR || 'backups/db'));
  const output = path.resolve(backupDir, argValue('output', backupName()));
  const pgDumpBin = process.env.PG_DUMP_BIN || 'pg_dump';

  const summary = {
    mode: dryRun ? 'dry-run' : 'backup',
    database: maskUrl(databaseUrl),
    output: path.relative(root, output),
    format: 'custom',
    prune: shouldPrune,
    retention_days: retentionDays,
  };

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  await fs.mkdir(backupDir, { recursive: true });
  await run(pgDumpBin, ['--format=custom', '--no-owner', '--no-acl', '--file', output, databaseUrl]);

  const stat = await fs.stat(output);
  const manifest = {
    ...summary,
    created_at: new Date().toISOString(),
    bytes: stat.size,
  };
  await fs.writeFile(`${output}.json`, JSON.stringify(manifest, null, 2));

  if (shouldPrune) {
    manifest.pruned = await pruneOldBackups(backupDir, retentionDays, false);
    await fs.writeFile(`${output}.json`, JSON.stringify(manifest, null, 2));
  }

  console.log(JSON.stringify({ ok: true, ...manifest }, null, 2));
}

main().catch((error) => {
  console.error('[backup-db] failed:', error?.message || error);
  process.exitCode = 1;
});

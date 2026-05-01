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

async function main() {
  await loadEnvFile(argValue('env-file', process.env.FRIENDSCAPE_ENV_FILE || '.env.production'));

  const databaseUrl = process.env.DATABASE_URL;
  const input = argValue('file');
  if (!databaseUrl) throw new Error('DATABASE_URL is required for database restore.');
  if (!input) throw new Error('Use --file=backups/db/friendscape-db-....dump to choose a backup.');

  const file = path.resolve(root, input);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new Error(`Backup file not found: ${input}`);

  const dryRun = args.has('--dry-run');
  const confirmed = args.has('--yes-i-understand');
  const isSql = file.endsWith('.sql');
  const command = isSql ? (process.env.PSQL_BIN || 'psql') : (process.env.PG_RESTORE_BIN || 'pg_restore');
  const commandArgs = isSql
    ? [databaseUrl, '--file', file]
    : ['--clean', '--if-exists', '--no-owner', '--no-acl', '--dbname', databaseUrl, file];

  const summary = {
    mode: dryRun ? 'dry-run' : 'restore',
    database: maskUrl(databaseUrl),
    file: path.relative(root, file),
    bytes: stat.size,
    command,
  };

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (!confirmed) {
    throw new Error('Restore is destructive. Re-run with --yes-i-understand after making a fresh backup.');
  }

  await run(command, commandArgs);
  console.log(JSON.stringify({ ok: true, ...summary, restored_at: new Date().toISOString() }, null, 2));
}

main().catch((error) => {
  console.error('[restore-db] failed:', error?.message || error);
  process.exitCode = 1;
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';

const execFileAsync = promisify(execFile);
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function intEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

function floatEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function add(out, level, key, detail, meta) {
  out.checks.push({ level, key, detail, ...(meta ? { meta } : {}) });
  if (level === 'alert') out.alerts.push(key);
  if (level === 'warn') out.warnings.push(key);
}

async function checkDatabase(out) {
  if (!process.env.DATABASE_URL) {
    add(out, 'alert', 'database_url_missing', 'DATABASE_URL is not configured.');
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('SELECT 1');
    add(out, 'ok', 'database', 'database SELECT 1 succeeded');
  } catch (error) {
    add(out, 'alert', 'database_unavailable', error?.message || 'database check failed');
  } finally {
    await client.end().catch(() => null);
  }
}

async function checkHealthEndpoint(out) {
  const explicit = argValue('url', process.env.MONITORING_HEALTH_URL || '');
  const base = argValue('base-url', process.env.MONITORING_BASE_URL || process.env.APP_PUBLIC_URL || '');
  const url = explicit || (base ? `${base.replace(/\/+$/g, '')}/api/health` : '');
  if (!url) {
    add(out, 'warn', 'health_endpoint_not_checked', 'MONITORING_HEALTH_URL or MONITORING_BASE_URL is not configured.');
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), intEnv('MONITORING_HTTP_TIMEOUT_MS', 5000));
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status === 'error') {
      add(out, 'alert', 'health_endpoint_unhealthy', `health endpoint returned ${response.status}`, { status: payload?.status || null });
    } else if (payload?.status === 'warn') {
      add(out, 'warn', 'health_endpoint_warn', 'health endpoint returned warning status');
    } else {
      add(out, 'ok', 'health_endpoint', `health endpoint ok (${response.status})`);
    }
  } catch (error) {
    add(out, 'alert', 'health_endpoint_failed', error?.message || 'health endpoint request failed');
  } finally {
    clearTimeout(timeout);
  }
}

async function checkDisk(out) {
  const target = process.env.MONITORING_DISK_PATH || root;
  const minFreePercent = floatEnv('MONITORING_MIN_FREE_DISK_PERCENT', 10);
  try {
    const { stdout } = await execFileAsync('df', ['-Pk', target], { timeout: 5000 });
    const lines = stdout.trim().split(/\r?\n/);
    const parts = lines.at(-1)?.trim().split(/\s+/) || [];
    const usedPercent = Number(String(parts[4] || '').replace('%', ''));
    const freePercent = Number.isFinite(usedPercent) ? 100 - usedPercent : null;
    if (freePercent == null) {
      add(out, 'warn', 'disk_parse_failed', `could not parse df output for ${target}`);
    } else if (freePercent < minFreePercent) {
      add(out, 'alert', 'disk_space_low', `free disk ${freePercent}% is below ${minFreePercent}%`, { target });
    } else {
      add(out, 'ok', 'disk_space', `free disk ${freePercent}%`, { target });
    }
  } catch (error) {
    add(out, 'warn', 'disk_check_failed', error?.message || 'disk check failed');
  }
}

async function checkBackups(out) {
  const dir = process.env.BACKUP_DIR || './backups';
  const maxAgeHours = intEnv('MONITORING_BACKUP_MAX_AGE_HOURS', 30);
  const fullDir = path.isAbsolute(dir) ? dir : path.join(root, dir);
  try {
    const entries = await fs.readdir(fullDir, { withFileTypes: true });
    let newest = null;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.(dump|sql)$/i.test(entry.name)) continue;
      const stat = await fs.stat(path.join(fullDir, entry.name));
      if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { name: entry.name, mtimeMs: stat.mtimeMs };
    }
    if (!newest) {
      add(out, 'warn', 'backup_not_found', `no .dump/.sql backup files found in ${dir}`);
      return;
    }
    const ageHours = (Date.now() - newest.mtimeMs) / 36e5;
    if (ageHours > maxAgeHours) {
      add(out, 'alert', 'backup_too_old', `latest backup ${newest.name} is ${ageHours.toFixed(1)}h old`, { maxAgeHours });
    } else {
      add(out, 'ok', 'backup_age', `latest backup ${newest.name} is ${ageHours.toFixed(1)}h old`);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') add(out, 'warn', 'backup_dir_missing', `backup dir ${dir} does not exist yet`);
    else add(out, 'warn', 'backup_check_failed', error?.message || 'backup check failed');
  }
}

async function checkLogFile(out) {
  const logFile = process.env.MONITORING_LOG_FILE || '';
  if (!logFile) {
    add(out, 'warn', 'log_file_not_checked', 'MONITORING_LOG_FILE is not configured; 5xx spike check is skipped.');
    return;
  }
  const threshold = intEnv('MONITORING_5XX_THRESHOLD', 20);
  const windowMinutes = intEnv('MONITORING_5XX_WINDOW_MINUTES', 5);
  const cutoff = Date.now() - windowMinutes * 60_000;
  try {
    const raw = await fs.readFile(logFile, 'utf8');
    const lines = raw.split(/\r?\n/).slice(-5000);
    let count = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      let item = null;
      try { item = JSON.parse(line); } catch { continue; }
      if (item?.event !== 'http.request') continue;
      const ts = Date.parse(item.ts || '');
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      const status = Number(item.status);
      if (status >= 500) count += 1;
    }
    if (count >= threshold) add(out, 'alert', 'five_xx_spike', `${count} 5xx responses in last ${windowMinutes} minutes`, { threshold });
    else add(out, 'ok', 'five_xx_spike', `${count} 5xx responses in last ${windowMinutes} minutes`, { threshold });
  } catch (error) {
    add(out, 'warn', 'log_file_check_failed', error?.message || 'could not read monitoring log file');
  }
}

async function main() {
  await loadEnvFile(argValue('env-file', process.env.FRIENDSCAPE_ENV_FILE || '.env.production'));
  const out = {
    checked_at: new Date().toISOString(),
    status: 'ok',
    checks: [],
    warnings: [],
    alerts: [],
  };

  await checkDatabase(out);
  await checkHealthEndpoint(out);
  await checkDisk(out);
  await checkBackups(out);
  await checkLogFile(out);

  out.status = out.alerts.length ? 'alert' : out.warnings.length ? 'warn' : 'ok';
  console.log(JSON.stringify(out, null, 2));
  if (args.has('--strict') && out.warnings.length) process.exit(1);
  if (out.alerts.length) process.exit(2);
}

main().catch((error) => {
  console.error(JSON.stringify({ checked_at: new Date().toISOString(), status: 'alert', error: error?.message || String(error) }, null, 2));
  process.exit(2);
});

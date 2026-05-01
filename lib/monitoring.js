import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import prisma from '@/lib/prisma';
import { getObjectStorageConfig } from '@/lib/object-storage';

const globalForMonitoring = globalThis;
const DEFAULT_HEALTH_TIMEOUT_MS = 3500;
const PACKAGE_CACHE = { loaded: false, value: { name: 'friendscape-next', version: '0.0.0' } };

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function intEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function levelEnabled(level) {
  const order = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
  const configured = String(process.env.LOG_LEVEL || 'info').trim().toLowerCase();
  return (order[level] || order.info) >= (order[configured] || order.info);
}

function safePathFromRequest(request) {
  try {
    return new URL(request?.url || '').pathname;
  } catch {
    return null;
  }
}

function safeMethodFromRequest(request) {
  return String(request?.method || 'GET').toUpperCase();
}

function requestHeader(request, name) {
  return request?.headers?.get?.(name) || null;
}

export function getRequestId(request) {
  const existing = requestHeader(request, 'x-request-id') || requestHeader(request, 'x-correlation-id');
  const trimmed = String(existing || '').trim();
  if (trimmed && /^[a-zA-Z0-9_.:-]{8,128}$/.test(trimmed)) return trimmed;
  return crypto.randomUUID();
}

function baseLogPayload(level, event, payload = {}) {
  return {
    ts: nowIso(),
    level,
    event,
    service: process.env.APP_SERVICE_NAME || 'friendscape',
    environment: process.env.NODE_ENV || 'development',
    ...payload,
  };
}

function writeLog(level, event, payload) {
  if (!levelEnabled(level)) return;
  const entry = baseLogPayload(level, event, payload);
  const format = String(process.env.LOG_FORMAT || 'json').trim().toLowerCase();
  const line = format === 'text'
    ? `[${entry.ts}] ${entry.level.toUpperCase()} ${entry.event} ${JSON.stringify(payload)}`
    : JSON.stringify(entry);
  const writer = level === 'error' || level === 'warn' ? console.error : console.log;
  writer(line);
}

export function logInfo(event, payload = {}) {
  writeLog('info', event, payload);
}

export function logWarn(event, payload = {}) {
  writeLog('warn', event, payload);
}

export function logError(event, error, payload = {}) {
  const safeError = {
    name: error?.name || 'Error',
    code: error?.code || error?.status || null,
    message: error?.message || String(error || 'unknown_error'),
  };
  if (boolEnv('LOG_ERROR_STACKS', process.env.NODE_ENV !== 'production') && error?.stack) {
    safeError.stack = String(error.stack).slice(0, 4000);
  }
  writeLog('error', event, { ...payload, error: safeError });
}

export function logRequest({ request, requestId, route, status, durationMs, userId = null, outcome = null }) {
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  writeLog(level, 'http.request', {
    requestId,
    method: safeMethodFromRequest(request),
    route: route || safePathFromRequest(request),
    status,
    durationMs,
    userId: userId == null ? null : String(userId),
    outcome,
  });
}

export async function withApiMonitoring(request, handler, options = {}) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const route = options.route || safePathFromRequest(request);

  try {
    const response = await handler({ requestId });
    const status = Number(response?.status || 200);
    if (typeof response?.headers?.set === 'function') response.headers.set('x-request-id', requestId);
    logRequest({
      request,
      requestId,
      route,
      status,
      durationMs: Date.now() - startedAt,
      userId: options.userId,
      outcome: options.outcome,
    });
    return response;
  } catch (error) {
    const status = Number(error?.status || 500);
    logError('http.request.error', error, {
      requestId,
      method: safeMethodFromRequest(request),
      route,
      status,
      durationMs: Date.now() - startedAt,
    });
    return Response.json(
      {
        error: 'Внутренняя ошибка сервиса.',
        code: 'INTERNAL_ERROR',
        requestId,
      },
      {
        status,
        headers: {
          'Cache-Control': 'no-store',
          'x-request-id': requestId,
        },
      }
    );
  }
}

async function readPackageMetadata() {
  if (PACKAGE_CACHE.loaded) return PACKAGE_CACHE.value;
  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8');
    const pkg = JSON.parse(raw);
    PACKAGE_CACHE.value = {
      name: pkg?.name || 'friendscape-next',
      version: pkg?.version || '0.0.0',
    };
  } catch {
    PACKAGE_CACHE.value = { name: 'friendscape-next', version: '0.0.0' };
  }
  PACKAGE_CACHE.loaded = true;
  return PACKAGE_CACHE.value;
}

function checkStatus(checks) {
  if (checks.some((item) => item.status === 'error')) return 'error';
  if (checks.some((item) => item.status === 'warn')) return 'warn';
  return 'ok';
}

function summarizeStorage(prefix) {
  const config = getObjectStorageConfig(prefix);
  if (config.enabled) {
    const missing = [];
    if (!config.endpoint) missing.push('endpoint');
    if (!config.bucket) missing.push('bucket');
    if (!config.accessKeyId) missing.push('access_key_id');
    if (!config.secretAccessKey) missing.push('secret_access_key');
    return {
      prefix,
      provider: config.provider,
      status: missing.length ? 'error' : 'ok',
      detail: missing.length ? `missing ${missing.join(', ')}` : `configured provider=${config.provider}, bucket=${config.bucket}`,
    };
  }

  const localAllowed = boolEnv(`${prefix}_ALLOW_LOCAL_IN_PRODUCTION`, false) || boolEnv('ALLOW_LOCAL_UPLOADS_IN_PRODUCTION', false);
  const isProd = process.env.NODE_ENV === 'production';
  return {
    prefix,
    provider: config.provider,
    status: isProd && !localAllowed ? 'warn' : 'ok',
    detail: isProd && !localAllowed
      ? 'object storage is not configured; local uploads are blocked in production'
      : `using ${config.provider || 'local'} storage mode`,
  };
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out`), { code: 'TIMEOUT' })), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getHealthStatus({ includeCounts = false } = {}) {
  const timeoutMs = intEnv('HEALTH_CHECK_TIMEOUT_MS', DEFAULT_HEALTH_TIMEOUT_MS);
  const checks = [];
  const pkg = await readPackageMetadata();

  checks.push({ key: 'app', status: 'ok', detail: 'application process is running' });
  checks.push({ key: 'env:DATABASE_URL', status: process.env.DATABASE_URL ? 'ok' : 'error', detail: process.env.DATABASE_URL ? 'configured' : 'missing' });

  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, timeoutMs, 'database check');
    checks.push({ key: 'database', status: 'ok', detail: 'SELECT 1 succeeded' });
  } catch (error) {
    checks.push({ key: 'database', status: 'error', detail: error?.code || error?.message || 'database check failed' });
    logError('health.database_failed', error, { route: '/api/health' });
  }

  for (const prefix of ['POST_MEDIA', 'CHAT_MEDIA', 'COMMUNITY_MEDIA', 'STORY_MEDIA']) {
    const storage = summarizeStorage(prefix);
    checks.push({ key: `storage:${prefix}`, status: storage.status, detail: storage.detail, meta: { provider: storage.provider } });
  }

  const realtimeMode = String(process.env.REALTIME_TRANSPORT || process.env.REALTIME_PROVIDER || (process.env.NODE_ENV === 'production' ? 'postgres' : 'memory')).trim().toLowerCase();
  const memoryRealtime = ['memory', 'local', 'in-memory', 'process'].includes(realtimeMode);
  checks.push({
    key: 'realtime',
    status: process.env.NODE_ENV === 'production' && memoryRealtime ? 'warn' : 'ok',
    detail: memoryRealtime ? 'memory realtime is suitable only for local dev or a single process' : `transport=${realtimeMode}`,
  });

  let counts = null;
  if (includeCounts) {
    const countDelegate = (delegate, args) => {
      if (!prisma[delegate] || typeof prisma[delegate].count !== 'function') return Promise.resolve(null);
      return prisma[delegate].count(args).catch(() => null);
    };
    const settled = await Promise.allSettled([
      countDelegate('session', { where: { expiresAt: { gt: new Date() } } }),
      countDelegate('supportTicket', { where: { status: { in: ['open', 'in_progress'] } } }),
      countDelegate('postReport', { where: { status: { in: ['new', 'pending', 'in_review'] } } }),
      countDelegate('commentReport', { where: { status: { in: ['new', 'pending', 'in_review'] } } }),
      countDelegate('targetReport', { where: { status: { in: ['new', 'pending', 'in_review'] } } }),
    ]);
    counts = {
      activeSessions: settled[0].status === 'fulfilled' ? settled[0].value : null,
      openSupportTickets: settled[1].status === 'fulfilled' ? settled[1].value : null,
      pendingPostReports: settled[2].status === 'fulfilled' ? settled[2].value : null,
      pendingCommentReports: settled[3].status === 'fulfilled' ? settled[3].value : null,
      pendingTargetReports: settled[4].status === 'fulfilled' ? settled[4].value : null,
    };
  }

  const status = checkStatus(checks);
  return {
    status,
    timestamp: nowIso(),
    app: {
      name: pkg.name,
      version: pkg.version,
      environment: process.env.NODE_ENV || 'development',
    },
    build: {
      commitSha: process.env.APP_GIT_SHA || process.env.GIT_COMMIT_SHA || process.env.COMMIT_SHA || null,
      buildTime: process.env.APP_BUILD_TIME || process.env.BUILD_TIME || null,
    },
    checks,
    ...(counts ? { counts } : {}),
  };
}

export function installProcessErrorLogging() {
  if (globalForMonitoring.__friendscapeMonitoringInstalled) return;
  globalForMonitoring.__friendscapeMonitoringInstalled = true;
  process.on('unhandledRejection', (reason) => {
    logError('process.unhandled_rejection', reason instanceof Error ? reason : new Error(String(reason)));
  });
  process.on('uncaughtException', (error) => {
    logError('process.uncaught_exception', error);
    process.exitCode = 1;
    const timer = setTimeout(() => process.exit(1), 50);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

installProcessErrorLogging();

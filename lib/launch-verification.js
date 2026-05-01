import fs from 'fs';
import prisma from '@/lib/prisma';

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function addCheck(target, { key, label, status, detail, meta }) {
  target.push({ key, label, status, detail, ...(meta ? { meta } : {}) });
}

function hasConfiguredAdmins() {
  const ids = String(process.env.ADMIN_USER_IDS || '').split(',').map((item) => item.trim()).filter(Boolean);
  const keys = String(process.env.ADMIN_USER_KEYS || '').split(',').map((item) => item.trim()).filter(Boolean);
  return { ok: ids.length > 0 || keys.length > 0, ids: ids.length, keys: keys.length };
}

function parseTrustedOrigins() {
  return String(process.env.CSRF_TRUSTED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function findMiddlewareConflicts(rootDir) {
  const entries = fs.readdirSync(rootDir);
  const middlewareFiles = entries.filter((name) => /^middleware\.(js|mjs|cjs|ts|tsx)$/.test(name));
  const proxyFiles = entries.filter((name) => /^proxy\.(js|mjs|cjs|ts|tsx)$/.test(name));
  return { middlewareFiles, proxyFiles };
}

export async function getLaunchVerification({ rootDir = process.cwd() } = {}) {
  const checks = [];
  const warnings = [];
  const errors = [];

  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    addCheck(checks, { key: 'db', label: 'Подключение к БД', status: 'ok', detail: 'Prisma смог выполнить SELECT 1.' });
  } catch (error) {
    addCheck(checks, { key: 'db', label: 'Подключение к БД', status: 'error', detail: error?.message || 'Не удалось проверить БД.' });
    errors.push('database_unavailable');
  }

  const delegates = ['user', 'session', 'post', 'comment', 'notification', 'supportTicket', 'postReport', 'conversation', 'chatMessage', 'userDevice'];
  const missingDelegates = delegates.filter((key) => typeof prisma[key] === 'undefined');
  if (missingDelegates.length) {
    addCheck(checks, {
      key: 'prisma_delegates',
      label: 'Prisma-модели launch-контура',
      status: 'error',
      detail: `В клиенте Prisma отсутствуют делегаты: ${missingDelegates.join(', ')}`,
    });
    errors.push('prisma_models_missing');
  } else {
    addCheck(checks, { key: 'prisma_delegates', label: 'Prisma-модели launch-контура', status: 'ok', detail: 'Критичные модели доступны в Prisma client.' });
  }

  const adminConfig = hasConfiguredAdmins();
  if (adminConfig.ok) {
    addCheck(checks, {
      key: 'admins',
      label: 'Настройка админ-доступа',
      status: 'ok',
      detail: `Сконфигурировано админов: ids=${adminConfig.ids}, keys=${adminConfig.keys}.`,
    });
  } else {
    addCheck(checks, {
      key: 'admins',
      label: 'Настройка админ-доступа',
      status: 'warn',
      detail: 'ADMIN_USER_IDS / ADMIN_USER_KEYS пустые. Админские экраны не будут доступны.',
    });
    warnings.push('admins_not_configured');
  }

  const appPublicUrl = String(process.env.APP_PUBLIC_URL || '').trim();
  if (!appPublicUrl) {
    addCheck(checks, {
      key: 'app_public_url',
      label: 'APP_PUBLIC_URL',
      status: 'warn',
      detail: 'APP_PUBLIC_URL не задан. Прод-окружение лучше не запускать без него.',
    });
    warnings.push('app_public_url_missing');
  } else {
    try {
      const parsed = new URL(appPublicUrl);
      const isProd = process.env.NODE_ENV === 'production';
      const secure = parsed.protocol === 'https:';
      if (isProd && !secure) {
        addCheck(checks, {
          key: 'app_public_url',
          label: 'APP_PUBLIC_URL',
          status: 'error',
          detail: 'В production APP_PUBLIC_URL должен использовать https.',
        });
        errors.push('app_public_url_insecure');
      } else {
        addCheck(checks, {
          key: 'app_public_url',
          label: 'APP_PUBLIC_URL',
          status: 'ok',
          detail: `Используется ${parsed.origin}.`,
        });
      }
    } catch {
      addCheck(checks, {
        key: 'app_public_url',
        label: 'APP_PUBLIC_URL',
        status: 'error',
        detail: 'APP_PUBLIC_URL задан, но это невалидный абсолютный URL.',
      });
      errors.push('app_public_url_invalid');
    }
  }

  const secureCookie = asBool(process.env.SESSION_COOKIE_SECURE, process.env.NODE_ENV === 'production');
  if (process.env.NODE_ENV === 'production' && !secureCookie) {
    addCheck(checks, {
      key: 'secure_cookie',
      label: 'Secure-cookie',
      status: 'error',
      detail: 'В production SESSION_COOKIE_SECURE должен быть включён.',
    });
    errors.push('secure_cookie_disabled');
  } else {
    addCheck(checks, {
      key: 'secure_cookie',
      label: 'Secure-cookie',
      status: secureCookie ? 'ok' : 'warn',
      detail: secureCookie ? 'Session cookie помечена как secure.' : 'Session cookie работает без secure вне production.',
    });
    if (!secureCookie) warnings.push('secure_cookie_off_nonprod');
  }

  const trustedOrigins = parseTrustedOrigins();
  addCheck(checks, {
    key: 'csrf_trusted_origins',
    label: 'CSRF trusted origins',
    status: trustedOrigins.length ? 'ok' : 'warn',
    detail: trustedOrigins.length
      ? `Разрешённые origin: ${trustedOrigins.join(', ')}`
      : 'CSRF_TRUSTED_ORIGINS не задан. Для reverse-proxy/нескольких доменов это риск.',
  });
  if (!trustedOrigins.length) warnings.push('csrf_trusted_origins_missing');

  const trustThreshold = Number(process.env.DEVICE_TRUST_AFTER_SESSIONS || 3);
  if (!Number.isFinite(trustThreshold) || trustThreshold < 2) {
    addCheck(checks, {
      key: 'device_threshold',
      label: 'Порог доверия устройствам',
      status: 'warn',
      detail: 'DEVICE_TRUST_AFTER_SESSIONS выглядит слишком низким. Рекомендуется 2+.',
    });
    warnings.push('device_threshold_low');
  } else {
    addCheck(checks, {
      key: 'device_threshold',
      label: 'Порог доверия устройствам',
      status: 'ok',
      detail: `Устройство считается доверенным после ${trustThreshold} сессий.`,
    });
  }

  const { middlewareFiles, proxyFiles } = findMiddlewareConflicts(rootDir);
  if (middlewareFiles.length && proxyFiles.length) {
    addCheck(checks, {
      key: 'proxy_conflict',
      label: 'proxy / middleware',
      status: 'error',
      detail: `Найдены одновременно proxy и middleware: ${[...proxyFiles, ...middlewareFiles].join(', ')}`,
    });
    errors.push('proxy_middleware_conflict');
  } else if (!proxyFiles.length) {
    addCheck(checks, {
      key: 'proxy_conflict',
      label: 'proxy / middleware',
      status: 'warn',
      detail: 'Файл proxy.* не найден. Защита маршрутов может не работать как ожидается.',
    });
    warnings.push('proxy_missing');
  } else {
    addCheck(checks, {
      key: 'proxy_conflict',
      label: 'proxy / middleware',
      status: 'ok',
      detail: `Используется ${proxyFiles.join(', ')} без конфликтующего middleware.*.`,
    });
  }

  const operationalCounts = await Promise.allSettled([
    prisma.session.count({ where: { expiresAt: { gt: new Date() } } }),
    prisma.notification.count({ where: { isRead: false } }),
    prisma.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
    prisma.postReport.count({ where: { status: 'new' } }),
  ]);

  const [activeSessions, unreadNotifications, openTickets, newReports] = operationalCounts.map((item) =>
    item.status === 'fulfilled' ? item.value : null,
  );

  addCheck(checks, {
    key: 'operational_surface',
    label: 'Операционный контур',
    status: 'ok',
    detail: 'Базовые moderation/support сущности доступны для чтения.',
    meta: {
      active_sessions: activeSessions,
      unread_notifications: unreadNotifications,
      open_tickets: openTickets,
      new_reports: newReports,
    },
  });

  const okCount = checks.filter((item) => item.status === 'ok').length;
  const total = checks.length || 1;
  const score = Math.round((okCount / total) * 100);
  const status = errors.length ? 'error' : warnings.length ? 'warn' : 'ready';

  return {
    status,
    score,
    checked_at: new Date().toISOString(),
    checks,
    warnings,
    errors,
    summary: {
      total_checks: total,
      ok: okCount,
      warn: checks.filter((item) => item.status === 'warn').length,
      error: checks.filter((item) => item.status === 'error').length,
    },
  };
}

# v90 — Monitoring / Logging / Alerting

Цель прохода: дать Friendscape минимальный production-слой наблюдаемости без внешней платформы и без усложнения приложения.

## Что добавлено

### Health checks

Добавлен публичный технический endpoint:

- `GET /api/health`
- `HEAD /api/health`

Он возвращает безопасную сводку:

- состояние app process;
- наличие `DATABASE_URL`;
- проверку БД через `SELECT 1`;
- статус media storage конфигурации для post/chat/community/story;
- предупреждение, если realtime всё ещё работает в memory-mode;
- версию приложения, окружение, build metadata.

Если БД недоступна или отсутствует критичная конфигурация, endpoint возвращает `503`.
Если есть только эксплуатационные предупреждения, например memory realtime, endpoint возвращает `200` со статусом `warn`.

### Admin monitoring overview

Добавлен admin-only endpoint:

- `GET /api/admin/monitoring/overview`

Он использует существующий admin guard и audit log. Помимо health status возвращает безопасные operational counts:

- активные сессии;
- открытые support tickets;
- pending post/comment/target reports.

### JSON logging

Добавлен `lib/monitoring.js`:

- `logInfo`;
- `logWarn`;
- `logError`;
- `logRequest`;
- `withApiMonitoring`;
- `getHealthStatus`.

Логи пишутся в stdout/stderr в JSON-формате по умолчанию. Это KISS-вариант, который хорошо работает с systemd, pm2, Docker и внешними log collectors.

Пример request log:

```json
{
  "ts": "2026-04-26T12:00:00.000Z",
  "level": "info",
  "event": "http.request",
  "service": "friendscape",
  "environment": "production",
  "requestId": "...",
  "method": "GET",
  "route": "/api/health",
  "status": 200,
  "durationMs": 14,
  "userId": null,
  "outcome": null
}
```

В логах не пишутся пароли, recovery-фразы, backup-коды, session tokens, CSRF tokens, DFSN raw-сигналы или storage secrets.

### Error logging

`logError` пишет:

- имя ошибки;
- код/status;
- безопасное сообщение;
- stack только если включён `LOG_ERROR_STACKS=1` или не production.

Также установлен process-level logging для:

- `unhandledRejection`;
- `uncaughtException`.

### Alert check script

Добавлен скрипт:

```bash
npm run monitor:alerts
npm run monitor:alerts:strict
```

Он проверяет:

- прямое подключение к БД;
- `/api/health`, если задан `MONITORING_BASE_URL` или `MONITORING_HEALTH_URL`;
- свободное место на диске;
- свежесть последнего backup-файла;
- всплеск 5xx по JSON log file, если задан `MONITORING_LOG_FILE`.

Exit codes:

- `0` — ok/warn без alert;
- `1` — strict-mode и есть warnings;
- `2` — есть alert.

Пример cron:

```cron
*/5 * * * * cd /var/www/friendscape-next && /usr/bin/npm run monitor:alerts >> /var/log/friendscape/monitoring.log 2>&1
```

## Env-переменные

```env
APP_SERVICE_NAME=friendscape
LOG_LEVEL=info
LOG_FORMAT=json
LOG_ERROR_STACKS=false
HEALTH_CHECK_TIMEOUT_MS=3500
MONITORING_BASE_URL=https://example.com
MONITORING_HEALTH_URL=
MONITORING_HTTP_TIMEOUT_MS=5000
MONITORING_DISK_PATH=/var/www/friendscape-next
MONITORING_MIN_FREE_DISK_PERCENT=10
MONITORING_BACKUP_MAX_AGE_HOURS=30
MONITORING_LOG_FILE=/var/log/friendscape/app.log
MONITORING_5XX_THRESHOLD=20
MONITORING_5XX_WINDOW_MINUTES=5
```

## Что осталось на будущие проходы

- v91 должен убрать зависимость realtime от одного процесса.
- Внешние alert destinations, например Telegram/email/webhook, пока не добавлены, потому что проект принципиально не собирает email/phone и сейчас лучше не тащить лишнюю инфраструктуру.
- Полное distributed tracing не добавлено: для текущего этапа достаточно requestId + JSON logs + health checks.

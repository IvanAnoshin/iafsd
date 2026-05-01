# Production deployment runbook v84

## Что изменилось в v84

- Production build больше не делает `prisma db push`.
- Для production-миграций добавлен `npm run deploy:migrate`, внутри — `prisma migrate deploy`.
- `npm run prisma:push` заблокирован при `NODE_ENV=production`.
- Добавлен `.env.production.example`.
- Усилен `check:env`.
- Обновлены Nginx, systemd и PM2 примеры.

## Базовый порядок релиза

```bash
npm ci
set -a
. ./.env.production
set +a
NODE_ENV=production npm run check:env
NODE_ENV=production npm run build:prod
# backup DB
NODE_ENV=production npm run deploy:migrate
sudo systemctl restart friendscape-next
curl -fsS "$APP_PUBLIC_URL/api/ready"
curl -fsS "$APP_PUBLIC_URL/api/version"
NODE_ENV=production npm run verify:launch
```

## Почему миграции отдельно от build

Build должен быть повторяемым и не должен менять production database. Production database меняется только отдельным явным шагом после backup.

## Первый запуск

1. Скопировать `.env.production.example` в `.env.production`.
2. Заполнить реальные домены, базу, storage, passkey origin.
3. Проверить env.
4. Собрать проект.
5. Сделать миграции.
6. Запустить через systemd или PM2.
7. Проверить `/api/ready` и основные пользовательские сценарии.

## Обязательные production-переменные

Минимум:

- `NODE_ENV=production`
- `DATABASE_URL`
- `APP_PUBLIC_URL`
- `SESSION_COOKIE_SECURE=true`
- `SESSION_COOKIE_SAME_SITE=lax` или `strict`
- `CSRF_TRUSTED_ORIGINS`
- `PASSKEY_RP_ID`
- `PASSKEY_ORIGIN`
- `STORAGE_*` или отдельные `CHAT_MEDIA_*`, `POST_MEDIA_*`, `COMMUNITY_MEDIA_*`, `STORY_MEDIA_*`

## Media storage

В production local uploads запрещены по умолчанию. Есть два честных режима:

1. S3-compatible object storage — рекомендуемый режим.
2. Local single-server storage — только если явно включить `*_MEDIA_ALLOW_LOCAL_IN_PRODUCTION=true` и регулярно backup-ить `public/uploads`.

## Проверки перед закрытой альфой

- `npm run audit:access-control`
- `npm run audit:sensitive-routes`
- `npm run audit:placeholders`
- `npm run verify:launch`
- ручной smoke по auth/feed/chat/communities/moderation/settings

## Чего v84 ещё не делает

- Не делает production-grade backup scripts. Это v85.
- Не масштабирует realtime на несколько процессов. Это v91.

## Monitoring после v90

Минимальная проверка production:

```bash
curl -fsS "$APP_PUBLIC_URL/api/health"
NODE_ENV=production npm run monitor:alerts
```

Рекомендуемый cron:

```cron
*/5 * * * * cd /var/www/friendscape-next && /usr/bin/npm run monitor:alerts >> /var/log/friendscape/monitoring.log 2>&1
```

Логи приложения должны оставаться JSON (`LOG_FORMAT=json`), чтобы их можно было забирать systemd/pm2/docker log collector-ом.

## v91 realtime scaling

Production should run with:

```env
REALTIME_TRANSPORT=postgres
REALTIME_PG_CHANNEL=friendscape_realtime
REALTIME_HISTORY_LIMIT=250
REALTIME_EVENT_RETENTION_DAYS=3
REALTIME_ALLOW_MEMORY_IN_PRODUCTION=false
```

Before deploying v91, run migrations:

```bash
npm run deploy:migrate
```

Then run:

```bash
npm run realtime:check
npm run verify:launch
```

The Postgres transport uses `RealtimeEvent` plus `LISTEN/NOTIFY`, so two Node processes connected to the same database can deliver chat, notification, presence, typing and unread-sync events to each other.


## Storage hardening check

Перед публичным запуском и после изменения media env запусти:

```bash
npm run storage:check
```

В production object storage должен быть приватным, а выдача файлов должна идти через /api/storage/* proxy с access-check и signed URL.

## v96 staging + release pipeline

Перед production-релизом сначала прогоняй staging:

```bash
npm run release:staging
npm run backup:db
npm run build:prod
npm run deploy:migrate
sudo systemctl restart friendscape-next-staging
npm run smoke:e2e
npm run monitor:alerts
```

Для production:

```bash
npm run release:prod:strict
npm run rollback:check
npm run backup:db
npm run build:prod
npm run deploy:migrate
sudo systemctl restart friendscape-next
npm run smoke:e2e
npm run monitor:alerts
```

Подробно: `docs/RELEASE_RUNBOOK.md` и `docs/ROLLBACK_RUNBOOK.md`.

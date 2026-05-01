# Release runbook

Цель: выпускать staging и production одинаково, без ручных догадок и без `prisma db push` в боевой базе.

## Инварианты релиза

- Сначала staging, потом production.
- Build не меняет базу.
- Миграции запускаются только отдельным шагом `npm run deploy:migrate`.
- Перед миграциями всегда делается backup базы.
- После деплоя всегда запускается smoke и monitoring check.
- Откат должен быть понятен до старта релиза.

## Staging release

```bash
cd /var/www/friendscape-next-staging
set -a
. ./.env.staging
set +a

NODE_ENV=production npm run check:env
NODE_ENV=production npm run release:check
NODE_ENV=production npm run backup:db
NODE_ENV=production npm run build:prod
NODE_ENV=production npm run deploy:migrate
sudo systemctl restart friendscape-next-staging
curl -fsS "$APP_PUBLIC_URL/api/health"
curl -fsS "$APP_PUBLIC_URL/api/version"
NODE_ENV=production npm run smoke:e2e
NODE_ENV=production npm run monitor:alerts
```

## Production release

```bash
cd /var/www/friendscape-next
set -a
. ./.env.production
set +a

NODE_ENV=production npm run check:env
NODE_ENV=production npm run release:check
NODE_ENV=production npm run rollback:check
NODE_ENV=production npm run backup:db
NODE_ENV=production npm run build:prod
NODE_ENV=production npm run deploy:migrate
sudo systemctl restart friendscape-next
curl -fsS "$APP_PUBLIC_URL/api/health"
curl -fsS "$APP_PUBLIC_URL/api/version"
NODE_ENV=production npm run smoke:e2e
NODE_ENV=production npm run monitor:alerts
```

## Что проверить перед production

1. Staging прошёл тот же commit/tag.
2. `APP_VERSION_TAG` и `APP_RELEASE_CHANNEL` выставлены.
3. Backup свежий и восстановимый.
4. `npm run rollback:check` не показывает критичных ошибок.
5. `npm run smoke:e2e` зелёный на staging.
6. Нет открытых blocker-багов из alpha/beta QA.

## После релиза

```bash
curl -fsS "$APP_PUBLIC_URL/api/health"
curl -fsS "$APP_PUBLIC_URL/api/version"
NODE_ENV=production npm run monitor:alerts
```

Если smoke или monitoring падают — не чинить на production вслепую, а переходить к `docs/ROLLBACK_RUNBOOK.md`.

# v84 — Production env + deploy checklist

## Выполнено

- Добавлен `.env.production.example`.
- Обновлён `.env.example` как local-dev шаблон.
- `prepare-prod` больше не делает `prisma db push`.
- Добавлен `deploy:migrate` через `prisma migrate deploy`.
- `prisma:push` заблокирован при `NODE_ENV=production`.
- `start-prod` запускает standalone server, если он собран, иначе fallback на `next start`.
- Усилен `check:env`: HTTPS, cookies, positive integer vars, storage, passkey warnings.
- Обновлён Nginx пример с HTTPS, upload limit, proxy headers и websocket upgrade.
- Обновлены systemd и PM2 примеры.
- Добавлены docs:
  - `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`
  - `docs/ENVIRONMENT_VARIABLES.md`
  - `docs/BACKUP_RESTORE.md`

## Проверки

- `node --check scripts/check-env.mjs`
- `node --check scripts/prepare-prod.mjs`
- `node --check scripts/migrate-prod.mjs`
- `node --check scripts/prisma-push-dev.mjs`
- `node --check scripts/start-prod.mjs`
- `npm run verify:launch`
- `npm run audit:access-control`
- `npm run audit:sensitive-routes`
- `npm run audit:placeholders`

## Не выполнено в v84

- Реальные backup/restore scripts и cleanup ops — это v85.
- Monitoring/logging/alerts — это v90.
- Realtime scaling — это v91.

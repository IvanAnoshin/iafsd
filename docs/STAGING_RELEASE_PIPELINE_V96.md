# v96 — Staging + Release Pipeline

## Что сделано

- Добавлен `.env.staging.example`.
- Добавлены staging deploy-примеры:
  - `deploy/staging/friendscape-next-staging.service`;
  - `deploy/staging/ecosystem.staging.config.cjs`;
  - `deploy/staging/nginx-staging.conf`.
- Добавлен release gate:
  - `npm run release:check`;
  - `npm run release:staging`;
  - `npm run release:prod`;
  - `npm run release:prod:strict`.
- Добавлен rollback gate:
  - `npm run rollback:check`.
- `/api/version` теперь показывает release metadata: `APP_ENV`, `APP_RELEASE_CHANNEL`, `APP_VERSION_TAG`.
- `check:env` проверяет `APP_ENV` и release-флаги.
- Добавлены runbook-и:
  - `docs/RELEASE_RUNBOOK.md`;
  - `docs/ROLLBACK_RUNBOOK.md`.

## KISS-подход

Здесь нет сложной CI/CD-системы. Проход добавляет понятный минимальный pipeline, который можно запускать локально на сервере или обернуть в GitHub Actions позже.

## Базовый поток

```text
branch/tag -> staging env -> backup -> build -> migrate -> restart -> smoke -> monitoring -> production -> rollback-ready
```

## Staging отдельно от production

Staging должен иметь:

- отдельную базу;
- отдельный storage bucket/prefix;
- отдельный домен;
- отдельные passkey origins;
- отдельные backup/log paths;
- ограниченный debug/admin доступ.

## Production gate

Перед production обязательно:

```bash
npm run release:check
npm run rollback:check
npm run backup:db
npm run build:prod
npm run deploy:migrate
npm run smoke:e2e
npm run monitor:alerts
```

## Rollback

Rollback описан в `docs/ROLLBACK_RUNBOOK.md`. Главный принцип: план отката должен быть проверен до миграции production database.

# Environment variables

Friendscape не собирает email и телефоны. Доступ и восстановление строятся вокруг username, пароля, passkey, recovery-фразы, backup-кодов, trusted devices, DFSN и внутренних ограничителей.

## Core

| Variable | Required | Notes |
|---|---:|---|
| `NODE_ENV` | prod | `production` на сервере. |
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `SHADOW_DATABASE_URL` | dev | Нужен для `prisma migrate dev`, не нужен для `migrate deploy`. |
| `APP_PUBLIC_URL` | yes | Публичный origin приложения. В production только `https://`. |
| `HOST` | no | Обычно `0.0.0.0`. |
| `PORT` | no | Обычно `3000`. |

## Cookies / CSRF

| Variable | Required | Notes |
|---|---:|---|
| `SESSION_COOKIE_NAME` | no | По умолчанию `fs_session`. |
| `SESSION_COOKIE_SECURE` | prod | В production должно быть `true`. |
| `SESSION_COOKIE_SAME_SITE` | no | `lax`, `strict` или `none`. |
| `CSRF_COOKIE_NAME` | no | По умолчанию `fs_csrf`. |
| `CSRF_TRUSTED_ORIGINS` | prod | Список origin через запятую. Минимум `APP_PUBLIC_URL`. |

## Admin

| Variable | Required | Notes |
|---|---:|---|
| `ADMIN_USER_IDS` | one of | Числовые ids админов через запятую. |
| `ADMIN_USER_KEYS` | one of | Normalized keys админов через запятую. |

## Recovery / trusted devices

| Variable | Required | Notes |
|---|---:|---|
| `RECOVERY_SESSION_TTL_MINUTES` | no | TTL recovery-сессии. |
| `RECOVERY_SECRET_PROMPT` | no | Текст вопроса/подсказки. |
| `DEVICE_TRUST_AFTER_SESSIONS` | no | По философии проекта устройство становится trusted не сразу. Default: 3. |

## Passkey / WebAuthn

| Variable | Required | Notes |
|---|---:|---|
| `PASSKEY_RP_NAME` | no | Display name. |
| `PASSKEY_RP_ID` | prod | Bare domain без протокола и порта. |
| `PASSKEY_ORIGIN` | prod | Например `https://friendscape.example.com`. |
| `PASSKEY_ALLOWED_ORIGINS` | recommended | Список разрешённых origin через запятую. |
| `PASSKEY_USER_VERIFICATION` | no | Обычно `preferred`. |

## Shared object storage

| Variable | Required | Notes |
|---|---:|---|
| `STORAGE_PROVIDER` | prod | `s3-compatible`, `s3`, `r2`, `yandex` или `local`. |
| `STORAGE_ENDPOINT` | object | Endpoint provider-а. |
| `STORAGE_BUCKET` | object | Bucket name. |
| `STORAGE_REGION` | object | Часто `auto` для R2. |
| `STORAGE_ACCESS_KEY_ID` | object | Access key. |
| `STORAGE_SECRET_ACCESS_KEY` | object | Secret key. |
| `STORAGE_PUBLIC_BASE_URL` | optional | CDN/public base URL. |
| `STORAGE_FORCE_PATH_STYLE` | optional | Обычно `true` для S3-compatible. |
| `STORAGE_PRIVATE` | optional | Default для media. |
| `STORAGE_SIGNED_READ_TTL_SECONDS` | optional | TTL signed URLs. |
| `STORAGE_CACHE_CONTROL` | optional | Cache-Control for uploaded objects. |

## Media namespaces

Есть четыре media namespace:

- `CHAT_MEDIA_*`
- `POST_MEDIA_*`
- `COMMUNITY_MEDIA_*`
- `STORY_MEDIA_*`

Каждый поддерживает:

| Suffix | Notes |
|---|---|
| `_ENABLED` | Включить/выключить upload. |
| `_STORAGE` | `local` или object storage provider. |
| `_ALLOW_LOCAL_IN_PRODUCTION` | Явный opt-in для local production storage. |
| `_IMAGE_MAX_BYTES` | Max image size. |
| `_VIDEO_MAX_BYTES` | Max video size. |
| `_STRIP_JPEG_EXIF` | Удаление EXIF, если применимо. |
| `_PREVIEWS_ENABLED` | Lightweight previews. |
| `_PREVIEWS_MODE` | Сейчас обычно `svg-poster`. |
| `_PRIVATE` | Приватность object storage. |
| `_SIGNED_READ_TTL_SECONDS` | TTL signed URL. |
| `_CACHE_CONTROL` | Cache-Control. |
| `_ENDPOINT`, `_BUCKET`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_PUBLIC_BASE_URL`, `_S3_FORCE_PATH_STYLE` | Specific object storage override. |

Chat media должен оставаться private в production.

## Chat / safety

| Variable | Notes |
|---|---|
| `CHAT_RATE_LIMIT_CONVERSATION_WINDOW_MS` | Window for per-conversation rate limit. |
| `CHAT_RATE_LIMIT_CONVERSATION_BURST` | Burst for per-conversation sending. |
| `CHAT_RATE_LIMIT_GLOBAL_WINDOW_MS` | Global window. |
| `CHAT_RATE_LIMIT_GLOBAL_BURST` | Global burst. |
| `CHAT_RATE_LIMIT_DUPLICATE_WINDOW_MS` | Duplicate message window. |
| `CHAT_RATE_LIMIT_DUPLICATE_BURST` | Duplicate burst. |
| `CHAT_SAFETY_FLAG_DEDUPE_WINDOW_MS` | Safety flag dedupe window. |
| `CHAT_SAFETY_REPORT_WINDOW_MS` | Report window. |

## Calls / WebRTC

| Variable | Notes |
|---|---|
| `CHAT_CALLS_ENABLED` | `1` or `0`. |
| `WEBRTC_PROVIDER` | Usually `native`. |
| `WEBRTC_STUN_URLS` | Comma-separated STUN URLs. |
| `WEBRTC_TURN_URLS` | Comma-separated TURN URLs. |
| `WEBRTC_TURN_USERNAME` | TURN username. |
| `WEBRTC_TURN_CREDENTIAL` | TURN credential. |

## Anti-abuse

| Variable | Notes |
|---|---|
| `RATE_LIMIT_CLEANUP_OLDER_THAN_HOURS` | Cleanup horizon. |
| `RATE_LIMIT_MEMORY_FALLBACK_IN_PRODUCTION` | Keep `false` for production. |

## Build metadata

| Variable | Notes |
|---|---|
| `APP_GIT_SHA` | Optional build commit. |
| `APP_BUILD_TIME` | Optional build timestamp. |

## Monitoring / logging / alerting

| Variable | Notes |
|---|---|
| `APP_SERVICE_NAME` | Service name written to JSON logs. |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error`, or `silent`. |
| `LOG_FORMAT` | `json` recommended for production; `text` is allowed for local debugging. |
| `LOG_ERROR_STACKS` | Keep `false` in production unless debugging a controlled incident. |
| `HEALTH_CHECK_TIMEOUT_MS` | Timeout for internal DB health checks. |
| `MONITORING_BASE_URL` | Base URL used by `npm run monitor:alerts` to call `/api/health`. |
| `MONITORING_HEALTH_URL` | Full health URL override. |
| `MONITORING_HTTP_TIMEOUT_MS` | HTTP timeout for alert checks. |
| `MONITORING_DISK_PATH` | Path checked for free disk space. |
| `MONITORING_MIN_FREE_DISK_PERCENT` | Alert threshold for free disk percent. |
| `MONITORING_BACKUP_MAX_AGE_HOURS` | Alert threshold for latest DB backup age. |
| `MONITORING_LOG_FILE` | Optional JSON log file used for 5xx spike detection. |
| `MONITORING_5XX_THRESHOLD` | Alert threshold for 5xx responses inside the window. |
| `MONITORING_5XX_WINDOW_MINUTES` | Time window for 5xx spike detection. |

## Realtime scaling

| Variable | Dev example | Production example | Meaning |
|---|---|---|---|
| `REALTIME_TRANSPORT` | `memory` | `postgres` | Realtime transport. Use `postgres` for multi-process production. |
| `REALTIME_PG_CHANNEL` | `friendscape_realtime` | `friendscape_realtime` | PostgreSQL LISTEN/NOTIFY channel name. |
| `REALTIME_HISTORY_LIMIT` | `250` | `250` | Maximum replay events per user request. |
| `REALTIME_EVENT_RETENTION_DAYS` | `3` | `3` | How long short-lived realtime events stay in DB before cleanup. |
| `REALTIME_ALLOW_MEMORY_IN_PRODUCTION` | `false` | `false` | Emergency override. Keep false for normal production. |

Production should use `REALTIME_TRANSPORT=postgres`. Memory transport is only for local development or a deliberately single-process emergency deployment.


## Media storage hardening / quotas

- `STORAGE_USER_DAILY_BYTES` — общий дневной лимит загрузок на пользователя.
- `STORAGE_SCOPE_DAILY_BYTES` — общий дневной лимит загрузок на раздел/scope.
- `CHAT_MEDIA_USER_DAILY_BYTES`, `POST_MEDIA_USER_DAILY_BYTES`, `COMMUNITY_MEDIA_USER_DAILY_BYTES`, `STORY_MEDIA_USER_DAILY_BYTES` — surface-specific пользовательские лимиты.
- `CHAT_MEDIA_SCOPE_DAILY_BYTES`, `POST_MEDIA_SCOPE_DAILY_BYTES`, `COMMUNITY_MEDIA_SCOPE_DAILY_BYTES`, `STORY_MEDIA_SCOPE_DAILY_BYTES` — surface-specific лимиты на диалог/пользователя/community/story-scope.
- `*_MEDIA_PRIVATE=true` в production означает, что клиент получает внутренний proxy URL, а реальный object-storage URL выдаётся только после access-check.
- `*_MEDIA_SIGNED_READ_TTL_SECONDS` задаёт TTL signed read URL. Рекомендуемое значение: 300 секунд.
- `MEDIA_REFERENCE_STRICT` — дополнительный v95 guard для прикрепления медиа по URL. В production строгая проверка включается автоматически; в dev можно оставить `false`, чтобы не ломать старые локальные данные без `MediaObject`.

## v96 staging / release variables

```env
APP_ENV=staging|production
APP_RELEASE_CHANNEL=staging|production
APP_VERSION_TAG=v0.0.0
RELEASE_REQUIRE_CLEAN_GIT=true
RELEASE_BACKUP_BEFORE_MIGRATE=true
RELEASE_SMOKE_AFTER_DEPLOY=true
```

`APP_ENV` is the deployment environment. Keep `NODE_ENV=production` for both staging and production so the app runs with production behavior.

Use `.env.staging.example` for staging and `.env.production.example` for production. Staging must use separate database, storage bucket, passkey origin, backup path and service port.

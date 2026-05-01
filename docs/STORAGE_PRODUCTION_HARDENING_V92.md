# v92 — Storage Production Hardening

Цель прохода: сделать загрузку и выдачу медиа безопаснее для production без тяжёлой новой архитектуры.

## Что изменилось

### 1. Upload validation

Добавлен общий модуль `lib/media-security.js`.

Он делает простые, но важные проверки перед записью файла:

- MIME берётся не только из `file.type`, но и сверяется с сигнатурой файла;
- опасные расширения заблокированы: `html`, `svg`, `js`, `exe`, `sh`, `ps1`, `php` и похожие;
- расширение файла должно соответствовать разрешённому типу;
- SVG не принимается как изображение;
- JPEG EXIF cleanup остаётся включённым по умолчанию.

Проверки подключены к:

- chat media;
- post/profile media;
- community media;
- story media.

### 2. Quotas

Добавлены дневные лимиты загрузок:

- общий пользовательский лимит: `STORAGE_USER_DAILY_BYTES`;
- общий лимит на scope: `STORAGE_SCOPE_DAILY_BYTES`;
- отдельные лимиты для `CHAT_MEDIA`, `POST_MEDIA`, `COMMUNITY_MEDIA`, `STORY_MEDIA`.

Scope означает:

- для чатов — диалог или пользовательский scope;
- для постов/профиля — пользователь;
- для сообществ — community id;
- для stories — пользователь.

### 3. MediaObject registry

Добавлена модель `MediaObject`.

Она хранит безопасные технические сведения о загруженных объектах:

- владелец;
- поверхность: chat/post/community/story;
- scope;
- kind/mime/detectedMime;
- storage/storageKey;
- bytes/previewBytes;
- статус active/deleted.

Это нужно для quotas, cleanup и будущих эксплуатационных проверок.

### 4. Storage key leakage

Upload API больше не отдаёт клиенту raw `storageKey` и `previewStorageKey`.

Клиент получает только URL, mime, bytes, preview flags и безопасную мета-информацию.

Для приватного object storage URL остаётся внутренним `/api/storage/...`, а доступ к реальному объекту выдаётся только через access-check proxy.

### 5. Signed read proxy

Storage proxy теперь использует более строгие headers:

- `Cache-Control: private, no-store`;
- `Referrer-Policy: no-referrer`;
- `X-Robots-Tag: noindex, nofollow`.

Signed object URL по-прежнему выдаётся только после проверки доступа.

### 6. Production env

В `.env.production.example` приватное media storage теперь включено по умолчанию:

- `STORAGE_PRIVATE=true`;
- `POST_MEDIA_PRIVATE=true`;
- `COMMUNITY_MEDIA_PRIVATE=true`;
- `STORY_MEDIA_PRIVATE=true`;
- `CHAT_MEDIA_PRIVATE=true`.

Кэш для production media изменён на private cache-control.

### 7. Cleanup

`cleanup-media` теперь учитывает `MediaObject`, если модель уже доступна в Prisma Client.

## Проверки

Команда:

```bash
npm run storage:check
```

Проверяет:

- наличие `lib/media-security.js`;
- наличие `MediaObject`;
- наличие migration;
- подключение validation/quota/registry во всех upload-модулях;
- отсутствие raw storage keys в upload API responses;
- signed proxy headers;
- quota env-переменные.

## Важное ограничение

Полный virus scanning/AV не внедрён. Для публичного запуска в будущем можно добавить отдельный async scanner, но v92 закрывает базовые production-риски без нового сервиса.

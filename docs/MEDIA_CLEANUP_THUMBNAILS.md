# Media cleanup + lightweight previews

Этот проход закрывает следующий слой production-подготовки медиа: единая уборка неиспользуемых файлов и реальные preview/thumbnail URL вместо режима `metadata-only`.

## Что добавлено

### 1. Lightweight preview generation

Для медиа без настоящей картинки-превью теперь создаётся SVG-preview:

- video;
- video note;
- voice/audio;
- generic file.

Изображения по-прежнему используют сам файл как `thumbUrl`, потому что без тяжёлых image-processing зависимостей безопаснее не резать картинки на web-сервере. Для production это хороший промежуточный слой: UI уже получает стабильный `thumbUrl`, а позже можно заменить SVG-preview на реальные transcoded thumbnails через отдельный worker.

Новый helper:

```text
lib/media-previews.js
```

Он не добавляет npm-зависимостей и работает с local/S3/R2/Yandex storage.

### 2. Preview metadata в payload

Upload payload теперь может содержать:

```json
{
  "thumbUrl": "/uploads/.../previews/file-preview.svg",
  "previewStorageKey": "posts/1/2026/04/previews/file-preview.svg",
  "previewBytes": 1234,
  "previewMime": "image/svg+xml; charset=utf-8",
  "previewGenerated": true
}
```

Это добавлено для:

- chat media;
- ordinary/profile post media;
- story media;
- community media.

### 3. Общий cleanup script

Новый скрипт:

```bash
npm run cleanup:media
```

Он сканирует локальные uploads:

- `public/uploads/communities`;
- `public/uploads/posts`;
- `public/uploads/chat`;
- `public/uploads/stories`.

И сверяет их с реальными ссылками из базы:

- `Community.avatarUrl`;
- `Community.coverUrl`;
- `Post.payload.media`;
- `ChatMessage.mediaUrl`;
- `ChatMessage.mediaThumbUrl`;
- `ChatMessage.metadata`.

По умолчанию это dry-run.

Удаление локальных файлов:

```bash
npm run cleanup:media:delete
```

### 4. Object storage cleanup

Для S3/R2/Yandex можно отдельно включить сканирование объектов:

```bash
npm run cleanup:media:object
```

Удаление orphan object keys:

```bash
npm run cleanup:media:object:delete
```

Object cleanup использует S3 ListObjectsV2 и сравнивает найденные ключи с ключами, которые реально сохранены в базе.

### 5. Stories cleanup

Так как stories сейчас живут в runtime-store, а не в отдельной постоянной таблице, cleanup для stories сделан осторожно: он удаляет только stale-файлы старше лимита.

Переменная:

```env
STORY_MEDIA_CLEANUP_STALE_HOURS=72
```

## Новые env-переменные

```env
CHAT_MEDIA_PREVIEWS_ENABLED=true
CHAT_MEDIA_PREVIEWS_MODE=svg-poster
POST_MEDIA_PREVIEWS_ENABLED=true
POST_MEDIA_PREVIEWS_MODE=svg-poster
STORY_MEDIA_PREVIEWS_ENABLED=true
STORY_MEDIA_PREVIEWS_MODE=svg-poster
COMMUNITY_MEDIA_PREVIEWS_ENABLED=true
COMMUNITY_MEDIA_PREVIEWS_MODE=svg-poster
STORY_MEDIA_CLEANUP_STALE_HOURS=72
```

## Важное ограничение

Это не полноценный transcoding pipeline. Тут нет ffmpeg/sharp и нет heavy image processing на Next.js сервере. Архитектурно теперь всё готово к следующему шагу: заменить SVG-preview на реальные thumbnails через отдельный worker или storage-trigger.

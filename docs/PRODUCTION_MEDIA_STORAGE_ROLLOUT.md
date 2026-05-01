# Production media storage rollout

## Что сделано в этом проходе

Расширен production storage adapter за пределы community media. Теперь слой объектного хранилища поддерживает:

- медиа сообществ — `COMMUNITY_MEDIA_*`;
- медиа чатов — `CHAT_MEDIA_*`;
- медиа обычных/профильных постов — `POST_MEDIA_*`;
- медиа моментов/stories — `STORY_MEDIA_*`.

Философия проекта сохранена: сервис не требует email или телефон для загрузки, просмотра и распространения медиа.

## Новые возможности

### Chat media

`lib/chat-media.js` теперь поддерживает:

- `CHAT_MEDIA_STORAGE=local | s3 | r2 | yandex`;
- загрузку изображений, видео, файлов, voice и video notes в S3-compatible storage;
- приватные object URLs через `/api/storage/chat/[...key]`;
- проверку доступа к conversation-scoped файлам через `ConversationMember`;
- удаление локальных и object-storage файлов через existing cleanup endpoint;
- JPEG EXIF cleanup для изображений.

Ключи объектного хранилища:

```text
chat/conversation/<conversationId>/<uploaderUserId>/<yyyy>/<mm>/<file>
chat/user/<uploaderUserId>/<yyyy>/<mm>/<file>
```

### Profile / ordinary post media

Добавлен `lib/post-media.js` и API:

```text
POST /api/profile/media/upload
GET  /api/storage/post/[...key]
```

Профильный composer теперь может прикреплять фото и видео к обычным постам. Посты сохраняют вложения в `Post.payload.media`, а профильный альбом подхватывает их через existing media extraction.

Ключи object storage:

```text
posts/<userId>/<yyyy>/<mm>/<file>
```

### Stories media

Добавлен `lib/story-media.js` и storage proxy:

```text
GET /api/storage/story/[...key]
```

`POST /api/stories/media/upload` теперь использует отдельный story media storage вместо chat media.

Ключи object storage:

```text
stories/<userId>/<yyyy>/<mm>/<file>
```

## Env-настройки

Добавлены блоки:

- `POST_MEDIA_*`;
- `STORY_MEDIA_*`;
- production-поля для `CHAT_MEDIA_*`;
- общий fallback `STORAGE_*`.

`local` режим сохранён для разработки. Для production лучше использовать `s3`, `r2` или `yandex`.

## Что осталось сделать

1. Сделать общий cleanup-скрипт для `posts`, `stories`, `chat`, `communities`.
2. Добавить thumbnail generation вместо `metadata-only`.
3. Добавить антивирусную проверку файлов перед публикацией.
4. Вынести приватность media proxy в единый helper, чтобы не плодить проверки доступа по разным route.
5. После подключения реального object storage отключить запись в `public/uploads` на production.

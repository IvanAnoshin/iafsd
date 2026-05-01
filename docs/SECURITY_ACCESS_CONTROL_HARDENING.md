# Security hardening / access-control pass

## Что закрыто в этом проходе

Этот проход усиливает защиту от IDOR-сценариев, где пользователь мог бы попытаться открыть или изменить чужую сущность по известному `id` или storage key.

### 1. Общий access-control слой

Добавлен `lib/access-control.js`:

- `loadPostForViewer(postId, viewerUserId)` — загружает пост и сразу проверяет видимость через `canViewerAccessPost`.
- `loadCommentForViewer(commentId, viewerUserId)` — загружает комментарий вместе с постом и проверяет, что пользователь имеет доступ к родительскому посту.
- `canReadPostMediaObject(key, viewerUserId)` — проверяет доступ к приватному object-storage медиа обычного поста.
- `canReadStoryMediaObject(key, viewerUserId)` — проверяет доступ к приватному object-storage медиа момента.
- `filterPostsForViewer(posts, viewerUserId)` — фильтрует коллекции постов через единое правило доступа.

### 2. Комментарии

Усилены routes:

- `PUT /api/comments/[id]`
- `DELETE /api/comments/[id]`
- `POST /api/comments/[id]/vote`
- `POST /api/reports/comments/[commentId]`

Теперь операции с комментарием проверяют не только автора/статус комментария, но и доступ пользователя к родительскому посту. Это важно для закрытых и приватных сообществ: известный `commentId` больше не даёт возможность голосовать, редактировать, удалять или отправлять жалобу вне зоны доступа.

### 3. Приватные object-storage media

Усилены proxy routes:

- `GET /api/storage/post/[...key]`
- `GET /api/storage/story/[...key]`

Для post media теперь есть проверка:

- владелец storage key может открыть собственный свежий upload;
- другой пользователь может открыть файл только если key найден в media payload поста, который ему разрешено видеть.

Для story media теперь есть проверка:

- владелец key может открыть собственный upload;
- другой пользователь может открыть файл только если момент автора доступен ему через stories listing.

### 4. Медиа в профиле пользователя

Усилены:

- `GET /api/users/[id]/media`
- `GET /api/users/[id]/posts`

Теперь выдача дополнительно фильтрует посты через `canViewerAccessPost`, чтобы медиа/посты из закрытых и приватных сообществ не утекали через профиль автора.

### 5. Аудитный скрипт

Добавлен скрипт:

```bash
npm run audit:access-control
```

Он формирует:

- `docs/access-control-audit.md`
- `docs/access-control-audit.json`

Скрипт не является заменой ручного security review, но помогает быстро находить risky места: raw `findUnique({ where: { id } })`, dynamic routes, storage proxy и media payload.

## Проверки после установки

```bash
npx prisma generate
npx prisma db push
npm run audit:access-control
npm run dev
```

## Что ещё нужно пройти дальше

- Admin routes: отдельно проверить, что каждая админская операция требует `requireAdminSession`.
- Chat calls: убедиться, что все call actions проверяют участника звонка.
- Devices/recovery/passkeys: пройти recovery-session ownership и challenge ownership.
- Search routes: проверить, что поиск не возвращает приватные сущности через side-channel.
- Local `public/uploads`: если media остаются публичными локально, их нельзя считать полноценной приватной защитой; для production нужен object storage private mode.

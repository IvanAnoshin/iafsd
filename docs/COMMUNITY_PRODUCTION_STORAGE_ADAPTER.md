# Community production storage adapter

Этот проход подготовил медиа сообществ к нормальному production-хранилищу без привязки к email/phone и без переписывания UI.

## Что добавлено

- `lib/object-storage.js` — S3-compatible adapter на встроенном Node.js `crypto` без новых зависимостей.
- Поддержка `COMMUNITY_MEDIA_STORAGE=local | s3 | r2 | yandex`.
- Server-side upload в S3/R2/Yandex Object Storage через AWS Signature V4.
- Signed GET URL для приватных объектов.
- Внутренний proxy route: `GET /api/storage/community/[...key]`.
- Проверка доступа к приватным community media по membership сообщества.
- JPEG EXIF cleanup для community image uploads.
- Расширенный media payload: `storage`, `storageKey`, `private`, `originalBytes`, `exifStripped`.
- Скрипт уборки неиспользуемых локальных community uploads.

## Env

Локальный режим разработки:

```env
COMMUNITY_MEDIA_STORAGE=local
```

S3/R2/Yandex режим:

```env
COMMUNITY_MEDIA_STORAGE=s3
COMMUNITY_MEDIA_ENDPOINT=https://s3.example.com
COMMUNITY_MEDIA_BUCKET=friendscape-community-media
COMMUNITY_MEDIA_REGION=auto
COMMUNITY_MEDIA_ACCESS_KEY_ID=...
COMMUNITY_MEDIA_SECRET_ACCESS_KEY=...
COMMUNITY_MEDIA_PUBLIC_BASE_URL=https://cdn.example.com
COMMUNITY_MEDIA_PRIVATE=false
COMMUNITY_MEDIA_S3_FORCE_PATH_STYLE=true
```

Для приватного режима:

```env
COMMUNITY_MEDIA_PRIVATE=true
COMMUNITY_MEDIA_PUBLIC_BASE_URL=
COMMUNITY_MEDIA_SIGNED_READ_TTL_SECONDS=300
```

В приватном режиме UI получает URL вида:

```text
/api/storage/community/communities/<communityId>/<purpose>/<yyyy>/<mm>/<file>
```

Этот route проверяет текущую сессию и права просмотра сообщества, затем делает короткую signed redirect-ссылку в object storage.

## Cleanup

Dry-run:

```bash
npm run cleanup:community-media
```

Удаление неиспользуемых локальных файлов:

```bash
npm run cleanup:community-media:delete
```

Скрипт сейчас безопасно работает только с локальными файлами в `public/uploads/communities`. Для object storage удаление старых файлов лучше делать отдельным lifecycle rule в бакете или отдельным production job после включения хранения object keys в базе.

## Ограничения текущего прохода

- Видео-превью не генерируются: для этого нужен отдельный worker с ffmpeg или managed transcoder.
- Thumbnails подготовлены на уровне контракта (`thumbUrl`), но без тяжелой обработки на web-сервере.
- Object storage upload идёт через backend server-side upload. Presigned direct upload из браузера можно добавить позже, когда появится отдельная таблица media assets и статус загрузки.

## Следующий шаг

Распространить такой же storage adapter на все медиа проекта: чат, профиль, истории и посты вне сообществ. После этого можно будет полностью убрать зависимость production от `public/uploads`.

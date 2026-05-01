# Communities Media + Attachments — v67

## Что добавлено

- Медиа-слой для сообществ без email и телефона.
- Локальное хранилище сообщества: `public/uploads/communities/<communityId>/<purpose>/...`.
- Новый helper `lib/community-media.js`, чтобы позже заменить local storage на S3/R2 без переписывания UI.
- Загрузка аватара и обложки сообщества через настройки.
- Поля Prisma у `Community`:
  - `avatarUrl`
  - `coverUrl`
  - `mediaCount`
- Загрузка фото/видео в composer поста сообщества.
- Хранение вложений в `Post.payload.media`.
- Посты с вложениями получают тип `media`.
- Раздел `Медиа` на странице сообщества.
- Медиа community-постов отображаются в общей ленте.
- Карточка сообщества в feed теперь может показывать реальный аватар.

## API

- `POST /api/communities/[slug]/media/upload`
  - `purpose=avatar|cover|post|gallery`
  - avatar/cover доступны owner/admin;
  - post/gallery доступны тем, кто может публиковать.
- `GET /api/communities/[slug]/media`
  - возвращает медиа из видимых community-постов.

## Ограничения текущего прохода

- Файлы пока сохраняются локально в `public/uploads/communities`.
- Превью для видео пока не генерируются отдельно.
- `mediaCount` увеличивается при публикации медиа-поста, но не пересчитывается при удалении старого поста.

## Следующий шаг

Подготовить production storage adapter: S3/R2/Yandex Object Storage, signed URLs, приватные файлы, очистка EXIF, генерация thumbnails и очистка неиспользуемых uploads.

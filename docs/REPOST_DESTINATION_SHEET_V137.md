# REPOST DESTINATION SHEET V137

## Что сделано
- Репост больше не выполняется мгновенно по кнопке «Поделиться».
- Добавлен общий `PostShareSheet` для ленты и профилей.
- Пользователь выбирает направление: профиль, сообщество, чат или ссылка.
- Репост в профиль поддерживает комментарий и видимость: публично, друзья, только я.
- Репост в сообщество показывает только сообщества, куда пользователь может публиковать.
- Отправка в чат осталась отдельным сценарием без создания Post.
- Ссылка копируется без отдельного success-баннера.
- Вложенный оригинал в репосте стал компактным preview без меню, кнопок и дублирующих метрик.
- Исправлена защита от `NaN` в счётчиках просмотров.

## Backend
- Добавлен `GET /api/posts/repost-targets`.
- `POST /api/posts/[id]/repost` теперь принимает `targetType`, `targetId`, `comment`, `visibility`.
- Дубли репостов проверяются отдельно для профиля и каждого сообщества.
- Репост репоста по-прежнему разворачивается до оригинала.

## Затронутые файлы
- `components/PostShareSheet.jsx`
- `components/PostRepostPreview.jsx`
- `components/profile/ProfilePostCardRich.jsx`
- `app/feed/page.jsx`
- `app/profile/page.jsx`
- `app/profile/[id]/page.jsx`
- `app/api/posts/[id]/repost/route.js`
- `app/api/posts/repost-targets/route.js`
- `lib/posts.js`
- `app/globals.css`

# Notification center cleanup

## Что сделано

- Вынесен общий компонент `components/NotificationCenter.jsx` вместо локального уведомительного sheet внутри feed.
- Центр уведомлений теперь сам:
  - загружает список уведомлений;
  - получает непрочитанный счётчик;
  - слушает realtime-события `notification.created`, `notification.read`, `notification.read_all`, `sync.unread`;
  - отмечает одно уведомление прочитанным;
  - отмечает все уведомления прочитанными;
  - использует CSRF для write-действий.
- Уведомления получили простую навигацию по сущностям:
  - посты → `/feed?post=...`;
  - комментарии → пост в feed;
  - профили → `/profile/...`;
  - чаты → `/chat?conversation=...`;
  - сообщества → `/communities/...`;
  - заявки/модерация сообщества → нужная вкладка сообщества.
- Из `app/feed/page.jsx` убран локальный notification-sheet и лишний feed-specific realtime listener.
- Добавлены события уведомлений для community-flow:
  - новая заявка на вступление;
  - новый участник;
  - вступление по invite-коду;
  - решение по заявке;
  - действия модерации по постам/комментариям;
  - жалобы в сообществах;
  - обновление статуса глобальной жалобы.

## Проверки

- `node --check` для изменённых server/lib файлов.
- JSX parse через TypeScript parser для `components/NotificationCenter.jsx` и `app/feed/page.jsx`.
- `npm run audit:placeholders`.
- `npm run audit:access-control`.
- `npm run audit:sensitive-routes`.

## Что осталось

- Добавить центр уведомлений не только в feed, но и в общий header/shell всех post-auth страниц.
- Расширить настройки уведомлений отдельными группами для сообществ и модерации.
- Сделать push/PWA-уведомления позже, если продукт пойдёт в PWA.

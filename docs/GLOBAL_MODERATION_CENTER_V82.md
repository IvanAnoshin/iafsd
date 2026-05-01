# v82 — Global Moderation Center

Цель прохода: дать проекту рабочее ядро глобальной модерации без тяжёлой архитектуры и без декоративных заглушек.

## Что добавлено

### 1. Единая очередь модерации

Новый endpoint:

- `GET /api/admin/moderation/queue`

Параметры:

- `status`: `pending`, `in_review`, `resolved`, `rejected`, `escalated`, `all`
- `type`: `all`, `post_report`, `comment_report`, `message_report`, `target_report`, `safety_flag`
- `limit`
- `offset`

Очередь объединяет:

- жалобы на посты;
- жалобы на комментарии;
- жалобы на сообщения;
- жалобы на профиль/сообщество через `target_report`;
- safety-флаги мессенджера.

Community-посты и community-комментарии попадают в ту же очередь как обычные post/comment reports, но с полем `community`.

### 2. Единая точка действий модератора

Новый endpoint:

- `POST /api/admin/moderation/actions`

Поддержанные действия:

- `set_status` — обновить статус жалобы/флага;
- `hide` — скрыть пост/комментарий/сообщение;
- `delete` — удалить пост/комментарий/сообщение;
- `restore` — восстановить пост/комментарий/сообщение;
- `warn` — отправить предупреждение пользователю;
- `mute` — создать ограничение пользователя;
- `ban` — создать глобальное ограничение пользователя;
- `unmute` — снять активные mute-ограничения;
- `unban` — снять активные ban-ограничения.

Пример:

```json
{
  "action": "hide",
  "entity_type": "post",
  "entity_id": 123,
  "reason": "Нарушение правил"
}
```

Пример ограничения:

```json
{
  "action": "mute",
  "entity_id": 42,
  "surface": "posting",
  "duration_hours": 24,
  "reason": "Спам"
}
```

### 3. Новые универсальные жалобы

Новый endpoint для пользовательских жалоб на профиль/сообщество:

- `POST /api/reports/target`

Поддержанные `target_type`:

- `profile`
- `community`

Пример:

```json
{
  "target_type": "profile",
  "target_id": "42",
  "reason": "spam",
  "details": "Подозрительный профиль"
}
```

### 4. Отдельные admin endpoints для новых очередей

- `GET /api/admin/reports/comments`
- `PUT /api/admin/reports/comments/:id/status`
- `GET /api/admin/reports/targets`
- `PUT /api/admin/reports/targets/:id/status`

Старые endpoints постов/сообщений сохранены.

### 5. Статусы v82

Новые глобальные статусы:

- `pending`
- `in_review`
- `resolved`
- `rejected`
- `escalated`

Для совместимости старые статусы тоже читаются:

- `new` → `pending`
- `open` → `pending`
- `reviewed` → `resolved`
- `actioned` → `resolved`
- `dismissed` → `rejected`

### 6. Ограничения пользователя

Добавлена модель `UserModerationRestriction`.

Она нужна для простого enforcement без лишней архитектуры:

- `ban` блокирует основные действия глобально;
- `mute` блокирует выбранную поверхность: `posting`, `chat`, `community`, `global`.

На этом проходе ограничения подключены к:

- созданию личного поста;
- созданию комментария;
- созданию community-поста;
- отправке сообщения в чат.

### 7. Audit log

Все новые admin endpoints пишут `AuditLog`:

- кто выполнил действие;
- над чем;
- какой action;
- причина/статус;
- успех или ошибка.

## Почему так

Реализация намеренно сделана в KISS-стиле:

- без отдельной сложной роли-модели;
- без тяжёлого UI в этом проходе;
- без дублирования community-модерации;
- с минимальным количеством новых сущностей;
- с сохранением старых endpoints.

## Что осталось на будущие проходы

1. Сделать полноценный UI глобального moderation center.
2. Добавить bulk actions.
3. Добавить фильтры по severity/target/reporter.
4. Добавить enforcement ограничений в дополнительные write routes: реакции, заявки, инвайты, шеры.
5. Добавить отдельные роли global moderator / admin / export, если проекту понадобится тоньше разделять права.

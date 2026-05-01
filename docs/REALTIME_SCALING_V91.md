# v91 — Realtime Scaling

Цель прохода: убрать зависимость realtime от памяти одного Node-процесса и подготовить чат/уведомления к запуску в нескольких процессах или инстансах.

## Что изменено

- Добавлен transport-слой `lib/realtime-transport.js`.
- `lib/chat-realtime.js` теперь является тонкой KISS-обёрткой над transport-слоем.
- Для production добавлен режим `REALTIME_TRANSPORT=postgres`.
- Postgres transport использует:
  - таблицу `RealtimeEvent` для короткой истории событий;
  - `LISTEN/NOTIFY` для fan-out между Node-процессами;
  - локальную доставку для SSE-клиентов текущего процесса.
- SSE route `/api/realtime/stream` теперь ждёт асинхронную подписку и может replay-ить события из БД.
- Cleanup expired data теперь удаляет просроченные `RealtimeEvent`.
- Добавлена проверка `npm run realtime:check`.

## Почему Postgres, а не Redis

В текущем стеке уже есть Postgres и пакет `pg`. Для v91 это самый простой вариант без нового сервиса. Redis/WebSocket gateway можно добавить позже, если нагрузка вырастет.

## Env

Development:

```env
REALTIME_TRANSPORT=memory
REALTIME_PG_CHANNEL=friendscape_realtime
REALTIME_HISTORY_LIMIT=250
REALTIME_EVENT_RETENTION_DAYS=3
REALTIME_ALLOW_MEMORY_IN_PRODUCTION=false
```

Production:

```env
REALTIME_TRANSPORT=postgres
REALTIME_PG_CHANNEL=friendscape_realtime
REALTIME_HISTORY_LIMIT=250
REALTIME_EVENT_RETENTION_DAYS=3
REALTIME_ALLOW_MEMORY_IN_PRODUCTION=false
```

`REALTIME_TRANSPORT=memory` в production заблокирован через `scripts/check-env.mjs`, если явно не поставить `REALTIME_ALLOW_MEMORY_IN_PRODUCTION=true`.

## Что масштабируется

Через общий realtime transport проходят уже существующие события:

- `message.created`;
- `message.updated`;
- `message.deleted`;
- `message.read`;
- `message_request.updated`;
- `chat.updated`;
- `typing.started` / `typing.stopped`;
- `presence.changed` / `presence.self`;
- `notification.created`;
- `notification.read`;
- `notification.read_all`;
- `sync.unread`;
- call events/signals.

## Ограничения

- Это всё ещё SSE, не отдельный WebSocket gateway.
- `LISTEN/NOTIFY` подходит для текущего уровня проекта, но при высокой нагрузке лучше перейти на Redis Pub/Sub или отдельный realtime gateway.
- История событий короткая и служит для reconnect/replay, не для долгого хранения.

## Проверки

```bash
node --check lib/realtime-transport.js
node --check lib/chat-realtime.js
node --check app/api/realtime/stream/route.js
node scripts/check-realtime-scaling.mjs
node scripts/verify-launch.mjs
node scripts/alpha-qa.mjs
node scripts/audit-placeholders.mjs
node scripts/audit-sensitive-routes.mjs
```

## Результат

После v91 realtime больше не зависит только от памяти одного процесса. Несколько Node-процессов, подключённых к одной базе, получают события друг друга через Postgres.

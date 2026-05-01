# Messenger Stabilization v81

База: `friendscape-v80-feed-posts-stabilization.zip`.
Цель прохода по плану: стабилизировать мессенджер без добавления хаотичных новых функций.

## Что проверено по плану v81

- Серверные chat-модули: `lib/chat.js`, `lib/chat-calls.js`, `lib/chat-media.js`, `lib/chat-observability.js`, `lib/chat-realtime.js`, `lib/chat-safety.js`.
- API-маршруты сообщений, пересылки, batch-delete, message requests, chat media upload и storage proxy.
- Текущие audit-скрипты: `audit:access-control`, `audit:sensitive-routes`, `audit:placeholders`.

## Исправления в этом проходе

1. Runtime seed-чаты больше не создаются автоматически.
   - До этого `listChatsForUser` вызывал `ensureSeedChatsForUser` всегда, если у пользователя не было диалогов.
   - Теперь seed включается только явно через `FRIENDSCAPE_ENABLE_SEED_CHATS=1|true|yes|on`.
   - Это снижает риск фейковых переписок в runtime.

2. Удалённые сообщения больше не возвращаются в основной истории диалога.
   - `getMessagesForConversation` теперь фильтрует `deletedAt: null`.
   - `getMessageContext` тоже не открывает контекст удалённого сообщения.
   - Это соответствует UX-решению: удалённый bubble не должен оставаться в переписке.

3. Превью диалога после удаления последнего сообщения теперь пересчитывается по последнему неудалённому сообщению.
   - `refreshConversationState` ищет latest message только среди `deletedAt: null`.
   - После удаления последнего сообщения чат не должен показывать “Сообщение удалено” как актуальный preview.

4. Trust/block проверка при отправке сообщения перенесена до создания записи сообщения.
   - Раньше hard-block мог сработать уже после `chatMessage.create`, что создавало риск фантомного сообщения.
   - Теперь hard-block останавливает отправку до записи в базу.

5. Повторные сообщения в pending outgoing request заблокированы.
   - Пока собеседник не принял запрос, отправитель не может накидывать новые сообщения в тот же pending request.
   - Повтор с тем же `clientId` всё ещё возвращает уже созданное сообщение и не ломает идемпотентность.

6. Access-control audit стал точнее распознавать chat-guarded маршруты.
   - В audit hints добавлены chat service-функции, внутри которых проверяется членство/участие в диалоге.
   - Это не отключает проверку, а уменьшает шум для маршрутов, где access-check вынесен в `lib/chat*`.

## Проверки

Выполнено:

```bash
node --check lib/chat.js
node --check lib/chat-calls.js
node --check lib/chat-media.js
node --check lib/chat-observability.js
node --check lib/chat-realtime.js
node --check lib/chat-safety.js
node --check app/api/chats/[id]/messages/route.js
node --check app/api/messages/[id]/route.js
node --check app/api/messages/forward/route.js
node --check app/api/messages/delete/batch/route.js
node --check app/api/message-requests/[id]/accept/route.js
node --check app/api/message-requests/[id]/reject/route.js
node --check app/api/message-requests/[id]/block/route.js
node --check app/api/storage/chat/[...key]/route.js
node --check app/api/chat/media/upload/route.js
node scripts/audit-access-control.mjs
node scripts/audit-sensitive-routes.mjs
node scripts/audit-placeholders.mjs
```

Результат audit после правок:

- `audit:access-control`: 141 findings, 67 needs review, 69 reviewed/guarded.
- `audit:sensitive-routes`: 0 flagged / 32 scanned.
- `audit:placeholders`: отчёт обновлён, основные остатки относятся уже к следующим проходам: people demo seed, runtime unavailable text, local uploads, process-memory realtime.

## Что осталось после v81

- Полный ручной smoke на живой базе: открыть чат, отправить текст, медиа, удалить, пожаловаться, принять request.
- Сократить оставшиеся non-chat access-control findings в следующих проходах.
- На v83 отдельно убрать people demo users и другие runtime-заглушки.
- На v91 вынести realtime из памяти процесса.
- На v92 hardened storage для production media.

## Остаток проходов

После этого частичного v81:

- до закрытой альфы: примерно 6 серьёзных проходов;
- до публичного запуска: примерно 16 серьёзных проходов.

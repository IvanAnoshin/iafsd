# Friendscape completion audit

Дата прохода: 2026-04-24  
База: текущая версия `v58-chat-filters-auto-hide`  
Принцип продукта: сервис не собирает email и телефоны, поэтому все сценарии строятся вокруг внутреннего аккаунта, username/имени, доверенных устройств, backup-кодов, recovery-фразы, passkey и внутренних уведомлений.

## Итоговая оценка

Проект уже имеет рабочий фундамент: авторизация, профили, лента, посты, комментарии, мессенджер, уведомления, stories/moments, DFSN, восстановление через внутренние механики, базовая админка и базовая модель сообществ.

Но до идеального рабочего состояния проекту нужен стабилизационный проход. Главные риски сейчас не в количестве фич, а в том, что часть поведения всё ещё временная: demo-seed данные, локальное хранение файлов, realtime в памяти процесса, неполный модуль сообществ, слабая тестовая база и несколько UI-мест с декоративными или неполными сценариями.

## Самые важные выводы

1. **Сообщества пока не production-ready.** Есть модели `Community` и `CommunityMember`, есть публичный список, поиск и admin-create, но нет полноценного пользовательского создания, страниц `/communities` и `/c/[slug]`, заявок, invite-кодов, ролей админ/модер на backend-уровне, правил, модерации и постов внутри сообщества.
2. **Demo/runtime seed надо убрать из пользовательских API.** `app/api/people/route.js` создаёт demo-пользователей во время обычного запроса. Это удобно для разработки, но недопустимо для production.
3. **Stories всё ещё имеют seed/demo fallback.** В `lib/stories.js` есть `seed-story-*` и demo markers. Для production это надо заменить real-empty-state логикой.
4. **Файлы хранятся локально.** Chat media лежит в `public/uploads/chat`. Для production нужен storage adapter и object storage.
5. **Realtime завязан на память процесса.** `lib/chat-realtime.js` использует `globalThis`, что ломается при нескольких Node-процессах или нескольких серверах.
6. **Нет полноценной тестовой системы.** Есть launch verification, но нет e2e/API regression тестов.
7. **UI нужно стабилизировать.** Глобальный CSS слишком большой и конфликтный; shell-уровни desktop/mobile надо выделять аккуратнее.

## Аудит заглушек

Добавлен скрипт:

```bash
npm run audit:placeholders
```

Он создаёт:

- `docs/placeholder-audit.md`
- `docs/placeholder-audit.json`

Текущий результат первого прохода:

| Категория | Количество срабатываний | Приоритет |
|---|---:|---:|
| Demo/seed runtime data | 27 | высокий |
| User-facing unavailable/fallback text | 57 | средний |
| Native browser alerts | 2 | средний |
| Local public uploads | 8 | высокий |
| Process-memory realtime | 3 | высокий |
| TODO/FIXME/HACK markers | 2 | низкий |

Важно: это статический сканер. Он даёт список мест для ручной проверки, а не говорит, что каждое срабатывание является багом. Например placeholder input — нормальный UI, а demo seed в runtime API — реальная production-проблема.

## Что уже хорошо

### Аккаунты без email/phone

У проекта уже есть внутренние recovery-механики:

- секретный вопрос/ответ;
- backup-коды;
- support recovery request;
- DFSN setup flow;
- trusted devices;
- sessions/logout-all;
- смена пароля.

Это хорошо совпадает с философией сервиса.

### Мессенджер

Мессенджер сейчас самый сильный модуль:

- чаты;
- заявки на переписку;
- сообщения;
- реакции;
- сохранённые;
- pin/mute/archive;
- поиск по сообщениям;
- пересылка;
- shared post cards;
- медиа upload;
- голосовые/видеокружки;
- звонки;
- realtime stream;
- unread summary;
- reports;
- safety flags.

### Лента и профиль

Есть рабочая база:

- посты;
- комментарии;
- голоса/лайки;
- saved posts;
- reports;
- feed settings;
- profile posts;
- media settings.

### Админка

Есть API для:

- reports;
- support tickets;
- safety flags;
- users;
- communities;
- analytics overview;
- launch verification.

Это уже хороший фундамент, но UI/операторские сценарии нужно развить.

## Что плохо и требует замены

### Runtime demo people

Файл: `app/api/people/route.js`

Проблема: обычный запрос к people может создавать demo-пользователей и демо-связи. В production все seed-данные должны создаваться только dev seed-скриптом или быть полностью отключены.

Решение:

- вынести demo people в `prisma/seed.dev.mjs` или `scripts/dev-seed.mjs`;
- в `/api/people` оставить только реальные запросы к базе;
- для пустого списка показывать real empty-state и предложения действий.

### Stories seed fallback

Файл: `lib/stories.js`

Проблема: `seed-story-*`, `isDemo`, `is_demo` и demo deep links.

Решение:

- удалить seed fallback из production runtime;
- если реальных моментов нет — показывать пустое состояние;
- dev-demo stories включать только через `NODE_ENV !== 'production' && ENABLE_DEMO_DATA=1`.

### Native alert

Файл: `app/feed/page.jsx`

Проблема: `window.alert` при отправке жалобы. Это ломает цельный UX.

Решение:

- заменить на внутренний toast/sheet status;
- все ошибки/успехи отображать через единый UI-notice слой.

### Local uploads

Файл: `lib/chat-media.js`

Проблема: файлы лежат в `public/uploads/chat`.

Решение:

- добавить storage abstraction: `lib/storage/index.js`;
- локальный драйвер оставить только для dev;
- production-драйвер: S3/R2/Yandex/Selectel;
- хранить original + thumbnail;
- добавить cleanup и privacy checks.

### Process-memory realtime

Файл: `lib/chat-realtime.js`

Проблема: `globalThis.__friendscapeChatRealtime` работает только в одном процессе.

Решение:

- вынести realtime bus в adapter;
- dev adapter — memory;
- production adapter — Redis Pub/Sub или Postgres LISTEN/NOTIFY.

### E2EE fallback

Текущее состояние: отправка может уйти без E2EE, если устройства не готовы.

Решение:

- разделить обычные и защищённые чаты;
- в защищённом чате запрещать тихий fallback;
- разрешать fallback только через явное подтверждение пользователя.

## Чего не хватает для идеального состояния

### Сообщества

Не хватает:

- страниц `/communities`, `/communities/create`, `/c/[slug]`;
- создания сообщества обычным пользователем;
- редактирования сообщества;
- ролей owner/admin/moderator/member с проверками на backend;
- заявок на вступление;
- invite-кодов;
- внутренних приглашений;
- правил сообщества;
- постов сообщества;
- модерации сообщества;
- банов/мутов;
- audit log действий модераторов;
- видимости участников;
- настроек приватности.

### Тесты

Не хватает:

- Playwright e2e;
- API regression tests;
- тестов прав доступа;
- тестов загрузки файлов;
- тестов сообществ;
- тестов восстановления доступа без email/phone.

### Production-инфраструктура

Не хватает:

- production migrations flow;
- backup/restore инструкции;
- объектного хранилища;
- Redis/realtime adapter;
- мониторинга ошибок;
- uptime checks;
- staging окружения;
- rollback процедуры.

## Рекомендуемый порядок работ

### Проход 1 — убрать runtime demo и явные заглушки

1. Убрать `ensureDemoUsers` из `/api/people`.
2. Убрать seed stories из production runtime.
3. Заменить `window.alert` на toast.
4. Все неготовые кнопки либо скрыть, либо связать с реальным API.

### Проход 2 — communities MVP

1. Расширить Prisma schema.
2. Добавить пользовательское создание сообщества.
3. Добавить страницу сообщества.
4. Добавить вступление/выход.
5. Добавить роли и backend permissions.
6. Добавить заявки и invite-коды.

### Проход 3 — storage/realtime adapters

1. `lib/storage` abstraction.
2. Dev local driver.
3. Production S3/R2 driver.
4. `lib/realtime-bus` abstraction.
5. Dev memory bus.
6. Production Redis/Postgres bus.

### Проход 4 — безопасность и права

1. Проверить IDOR по постам, чатам, файлам, сообществам.
2. Добавить rate limits.
3. Доделать CSRF везде, где есть mutation.
4. Усилить recovery без email/phone.

### Проход 5 — тесты и QA

1. Добавить Playwright.
2. Покрыть основные пользовательские сценарии.
3. Покрыть API permissions.
4. Прогнать мобильный и desktop QA.

## Definition of Done

Проект можно считать готовым к рабочему запуску, когда:

- нет runtime demo seed;
- нет кнопок, которые выглядят рабочими, но ничего не делают;
- сообщества можно создать, найти, открыть, настроить и модерировать;
- посты, чаты, сообщества и файлы защищены backend-проверками;
- файлы не лежат только в локальном `public/uploads`;
- realtime не зависит от одного Node-процесса;
- восстановление доступа работает без email/phone;
- есть e2e тесты ключевых сценариев;
- есть production deploy/backup/restore инструкция.

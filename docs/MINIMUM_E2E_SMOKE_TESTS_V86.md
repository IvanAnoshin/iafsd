# v86 — Minimum E2E / Smoke Tests

Цель прохода: добавить минимальные проверки, которые быстро ловят поломку базовых сценариев перед следующим проходом.

## Что добавлено

1. `scripts/smoke-e2e.mjs`
   - KISS smoke-runner без внешних зависимостей;
   - работает через реальные HTTP API уже запущенного приложения;
   - сам регистрирует двух smoke-пользователей без email/phone;
   - проверяет cookie/session/CSRF там, где это нужно;
   - падает с понятной ошибкой при первом сломанном сценарии.

2. `playwright.config.mjs`
   - минимальная конфигурация Playwright;
   - по умолчанию использует `npm run dev`;
   - можно подключиться к уже запущенному серверу через `FRIENDSCAPE_E2E_SKIP_WEB_SERVER=1`.

3. `tests/smoke/pages.spec.js`
   - лёгкая проверка ключевых страниц;
   - цель — поймать 5xx, сломанную сборку страницы или пустой body.

4. `package.json`
   - `npm run smoke:e2e`;
   - `npm run test:e2e`;
   - `npm run test:e2e:pages`;
   - добавлен devDependency `@playwright/test`.

5. Дополнительно исправлена синтаксическая ошибка в `app/api/auth/login/route.js`, которую должен ловить этот проход.

## Что проверяет `npm run smoke:e2e`

Smoke-runner покрывает минимальную альфа-цепочку:

- Auth:
  - регистрация без email/phone;
  - DFSN-шаг регистрации;
  - backup codes на завершении регистрации;
  - `/api/me`;
  - страница `/recover/phrase`;
  - passkeys API;
  - создание recovery-фразы;
  - logout;
  - login по паролю.

- Feed:
  - создать пост;
  - отредактировать пост;
  - поставить лайк;
  - создать комментарий;
  - удалить пост.

- Chat:
  - открыть direct conversation;
  - отправить сообщение;
  - прочитать сообщения вторым пользователем;
  - пожаловаться на сообщение;
  - удалить выбранное сообщение.

- Communities:
  - создать public community;
  - создать community-пост;
  - вступить вторым пользователем;
  - выйти;
  - создать closed community;
  - подать заявку;
  - посмотреть заявки владельцем;
  - принять заявку.

- Notifications:
  - открыть центр уведомлений;
  - mark all read.

## Как запускать локально

В одном терминале:

```bash
npm run dev
```

Во втором терминале:

```bash
FRIENDSCAPE_SMOKE_BASE_URL=http://127.0.0.1:3000 npm run smoke:e2e
```

Для Playwright page smoke:

```bash
npx playwright install chromium
npm run test:e2e:pages
```

Если сервер уже запущен:

```bash
FRIENDSCAPE_E2E_SKIP_WEB_SERVER=1 FRIENDSCAPE_E2E_BASE_URL=http://127.0.0.1:3000 npm run test:e2e:pages
```

## Важные ограничения

- `smoke:e2e` создаёт временных пользователей и сообщества с префиксом `Smoke...`.
- Скрипт удаляет созданный пост и сообщение, но пользователей/сообщества не удаляет, потому что в продукте нет публичного безопасного delete-user/delete-community flow.
- Для production запускать smoke лучше на staging, а не на живой базе.
- `npm run build` этим проходом не заменяется: smoke проверяет сценарии на уже поднятом приложении.

## Definition of Done для v86

- Скрипт smoke есть и парсится через `node --check`.
- Playwright-конфиг и smoke-spec есть и парсятся через `node --check`.
- Базовые audit scripts продолжают работать.
- Найденная синтаксическая ошибка в login route исправлена.

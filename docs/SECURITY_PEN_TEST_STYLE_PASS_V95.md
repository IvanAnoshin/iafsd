# v95 — Security Pen-test Style Pass

Цель прохода: пройтись по проекту как по pre-launch security review и закрыть практичные риски без большого рефакторинга и без раскрытия внутренних деталей DFSN.

## Что усилено

### 1. Media reference IDOR

До v95 загрузка файлов уже проверяла MIME, расширения, квоты и приватную отдачу через storage proxy. Но создание поста, сообщения или момента всё ещё могло получить вручную подставленный `media.url`.

Теперь перед сохранением payload выполняется проверка через `MediaObject`:

- личные посты могут прикреплять только свои `post`-media;
- community-посты могут прикреплять только media нужного сообщества;
- chat-сообщения могут прикреплять только chat-media отправителя в этом conversation/user scope;
- stories могут прикреплять только story-media автора;
- неподтверждённые ссылки в production блокируются.

Это закрывает сценарий, когда пользователь пытается прикрепить чужой private media URL или угадываемый storage/proxy URL.

### 2. CSRF failure shape

Найден и исправлен класс ошибок, где часть route handlers пыталась вернуть `csrf.error` / `csrf.status`, хотя `verifyCsrf()` возвращает готовый `response`.

Теперь эти маршруты возвращают единый `csrf.response`, без риска некорректного статуса.

### 3. URL/XSS hardening для media ссылок

Добавлены серверный и клиентский URL sanitizers:

- `sanitizeClientMediaUrl()`;
- `sanitizeUrlForClient()`.

Они отбрасывают `javascript:`, `data:`, `vbscript:`, `file:` и некорректные URL. Это используется в местах, где media URL попадает в `href`, `src` или payload.

### 4. CSP hardening

`unsafe-eval` теперь ограничен non-production веткой. Production CSP не должен включать `unsafe-eval`; также добавлен production-only `upgrade-insecure-requests`.

### 5. Проверочный security script

Добавлен:

```bash
npm run security:check
```

Скрипт проверяет:

- наличие media scope guard;
- usage guard в post/community/chat/story flows;
- отсутствие старого `csrf.error` / `csrf.status` pattern;
- client URL sanitizer на ключевых страницах;
- production CSP split;
- отсутствие неразрешённого `dangerouslySetInnerHTML`.

Отчёты:

- `docs/security-pass-report.md`;
- `docs/security-pass-report.json`.

## Что намеренно не раскрывается

DFSN остаётся закрытой технологией. В этом проходе не публиковались:

- внутренние сигналы DFSN;
- веса и пороги доверия;
- антиобходные эвристики;
- условия, при которых устройство получает trusted-state;
- внутренние правила корреляции security-событий.

## Проверки

Минимальный набор после v95:

```bash
npm run security:check
npm run audit:sensitive-routes
npm run audit:access-control
npm run audit:placeholders
npm run verify:launch
npm run qa:alpha
```

## Ограничения

- Это pre-launch security pass, не внешний pentest.
- Полный runtime E2E нужно прогнать уже с `node_modules`, рабочей БД и поднятым сервером.
- Access-control audit остаётся статическим guardrail: false positives надо разбирать вручную, а не механически переписывать код.

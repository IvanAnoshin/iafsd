# v87 Final Alpha QA + Bugfix

Цель прохода: закрыть подготовку к закрытой альфе без тяжёлого рефакторинга.

## Что сделано

1. Добавлен `docs/ALPHA_RELEASE_NOTES.md`.
2. Добавлен `scripts/alpha-qa.mjs` и команда `npm run qa:alpha`.
3. Добавлены отчёты `docs/alpha-qa-report.md` и `docs/alpha-qa-report.json`.
4. Защищённые страницы теперь получают `Cache-Control: no-store` через `proxy.js`.
5. В protected-набор добавлены `/communities` и `/stories`.
6. В `next.config.js` добавлен no-store header для core/auth/recovery страниц.
7. `POST /api/support/tickets` получил CSRF guard.
8. `verify-launch` расширен страницами communities/stories и alpha release notes.

## Ручной QA по ролям

- Новый пользователь: регистрация, DFSN, onboarding, первый вход.
- Обычный пользователь: профиль, лента, люди, чат, уведомления.
- Владелец сообщества: создание community, заявки, инвайты, посты, медиа.
- Модератор сообщества: community moderation actions.
- Глобальный admin/moderator: очередь жалоб, support tickets, audit log.

## Ручной QA по устройствам

- Desktop ширина.
- Tablet-ish ширина.
- iPhone/390px.
- Android/360px.
- Низкий экран с открытой клавиатурой в чате.

## Что проверять перед выдачей альфе

- Нет критичных console errors.
- Нет неожиданных 404/500 в базовых сценариях.
- Sensitive pages не кэшируются.
- Write actions проходят CSRF или явно находятся в auth/recovery allowlist.
- Empty/loading/error states честные, без фейковых пользователей и демо-данных.
- Backup/restore инструкции есть.
- Smoke/e2e набор готов к запуску на staging/local.

## Известные ограничения

- Process-memory realtime остаётся до v91.
- Production-grade media hardening остаётся до v92.
- Monitoring/logging/alerting остаётся до v90.
- Legal/trust pages остаются до v88.
- Data export/delete account остаётся до v89.

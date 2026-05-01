# v97 — Public Beta QA

Цель прохода: подготовить Friendscape к публичной beta-версии после закрытия основных production-блоков.

## Что сделано

1. Добавлена страница `/feedback`.
   - Авторизованный пользователь может отправить отзыв о бете или баг.
   - Отправка идёт через существующий `SupportTicket` flow.
   - Используется CSRF token.
   - Пользователь видит понятный success/error status.
   - В тикет добавляется безопасный минимальный контекст: source, path, viewport, severity.
   - Пароли, recovery-фразы и backup-коды не запрашиваются.

2. Добавлена точка входа в feedback flow.
   - Точка входа в feedback flow перенесена в настройки, без плавающего pill в нижней навигации.
   - В настройках добавлены категории beta feedback / beta bug / onboarding.

3. Убраны beta-рискованные декоративные элементы.
   - Chat debug mode отключён в production даже при `?debug=1`.
   - Убран fake fallback chat seed из runtime.
   - Проверка beta QA контролирует отсутствие `console.log` в app/components runtime.

4. Добавлен beta QA gate.
   - `npm run beta:qa`
   - Генерирует `docs/public-beta-qa-report.md` и `.json`.
   - Проверяет feedback flow в настройках, отсутствие fake chat seed, production env, beta docs, smoke-page coverage и read-only ленту без composer.

5. Обновлены launch/alpha проверки.
   - `verify:launch` теперь проверяет v97 docs, `/feedback` и `beta:qa`.
   - `qa:alpha` теперь тоже учитывает `/feedback` и `beta:qa`.

## Critical beta scenarios для ручной проверки

Перед публичной бетой вручную пройти:

1. First-run / onboarding.
   - Открыть `/`.
   - Зарегистрироваться без email/phone.
   - Пройти DFSN setup.
   - Сохранить recovery phrase / backup-коды.
   - Войти повторно.

2. Первый пост.
   - Открыть `/feed`.
   - Создать пост.
   - Отредактировать.
   - Поставить реакцию.
   - Открыть комментарии.
   - Удалить пост.

3. Первый чат.
   - Найти пользователя.
   - Создать диалог или принять заявку.
   - Отправить сообщение.
   - Отправить media, если storage настроен.
   - Пожаловаться на сообщение.

4. Первое сообщество.
   - Создать public community.
   - Создать community post.
   - Выйти/вступить.
   - Создать closed community и проверить request flow.

5. Feedback/report bug.
   - Открыть `/feedback`.
   - Отправить `beta_bug`.
   - Убедиться, что тикет появляется в настройках и admin support queue.

6. Mobile QA.
   - 360px ширина.
   - 390px ширина.
   - Низкий экран.
   - Keyboard open в чате.
   - Bottom sheets не перекрывают composer.

## Что считается известным ограничением beta

- Полный `npm run build` нужно выполнять уже в окружении с `node_modules`.
- Playwright smoke требует поднятый сервер и рабочую БД.
- Для production нужен реальный `.env.production`, а не example-файл.
- Email/phone intentionally отсутствуют по философии продукта.
- DFSN детали не раскрываются: публично описываются только принципы безопасности, не сигналы, веса, пороги и эвристики.

## Команды перед beta release

```bash
npm ci
npm run prisma:generate
npm run check:env -- --env-file=.env.production
npm run verify:launch
npm run qa:alpha
npm run beta:qa
npm run security:check
npm run release:prod:strict
npm run build
npm run smoke:e2e
```

## Результат

После v97 проект имеет финальный beta QA gate, понятный feedback/report-bug flow и release notes для публичной беты.

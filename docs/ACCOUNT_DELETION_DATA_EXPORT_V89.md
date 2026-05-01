# v89 — Account deletion / data export

## Цель

Дать пользователю контроль над своими данными без email и телефона: скачать экспорт, временно деактивировать аккаунт, создать или отменить запрос на удаление.

## Что добавлено

- `POST /api/account/export` — JSON-экспорт данных аккаунта после подтверждения текущим паролем.
- `GET /api/account/deletion` — статус аккаунта, деактивации и pending-запроса на удаление.
- `POST /api/account/deletion` — действия `request`, `cancel`, `deactivate`, `reactivate` после подтверждения текущим паролем.
- `scripts/process-account-deletions.mjs` — обработка due-запросов на удаление. Dry-run по умолчанию.
- npm-команды:
  - `npm run account:deletions`
  - `npm run account:deletions:delete`
- Prisma-модели:
  - `UserDataExport`
  - `AccountDeletionRequest`
- Поля жизненного цикла в `User`: `accountStatus`, `deactivatedAt`, `deletionRequestedAt`, `deletionScheduledAt`, `deletionReason`, `deletedAt`.
- В настройках добавлен раздел «Данные и аккаунт».

## Что входит в экспорт

- профиль и публичные настройки профиля;
- настройки приватности, ленты и медиа;
- security-summary без секретов;
- посты пользователя;
- комментарии пользователя;
- отправленные сообщения пользователя;
- сохранённые сообщения metadata;
- членство и владение сообществами;
- уведомления;
- trusted devices metadata;
- passkey metadata без public key;
- support tickets и жалобы пользователя;
- moderation restrictions пользователя.

## Что не входит в экспорт

- `passwordHash`;
- `secretAnswerHash`;
- `backupCodeHashes`;
- `recoveryPhraseHash`;
- raw DFSN-профиль, сигналы, веса и пороги;
- passkey public keys;
- encrypted E2EE backup blobs;
- приватный контент других пользователей.

## Удаление

Удаление не выполняется мгновенно кнопкой. Запрос получает статус `pending`, аккаунт получает `accountStatus = pending_deletion`, а `scheduledFor` рассчитывается через `ACCOUNT_DELETION_GRACE_DAYS`.

До наступления `scheduledFor` пользователь может отменить запрос в настройках.

Фактическая обработка due-запросов:

```bash
npm run account:deletions        # dry-run
npm run account:deletions:delete # применить удаление/анонимизацию
```

## Что делает обработчик удаления

- помечает посты и комментарии пользователя как deleted;
- удаляет/очищает отправленные сообщения и медиа-поля сообщений;
- завершает сессии;
- удаляет trusted devices, passkeys, passkey challenges, recovery sessions, E2EE devices/backups;
- удаляет социальные связи и pending-заявки;
- снимает владельца с owned communities;
- анонимизирует имя, normalizedKey и public profile;
- переводит аккаунт в `accountStatus = deleted`.

## KISS-ограничения v89

- Экспорт отдаётся сразу как JSON, без отдельного файлового хранилища экспортов.
- Нет тяжёлой UI-страницы: управление встроено в настройки.
- Due deletion выполняется отдельной командой, которую можно повесить на cron после production-деплоя.
- Удаление медиа-объектов из object storage остаётся задачей storage cleanup v92, потому что физические файлы требуют отдельной политики retention.

# Admin + recovery security review

Цель прохода: отдельно усилить чувствительные зоны проекта, которые нельзя оставлять только на обычной сессии: admin routes, recovery без email/phone, passkey и trusted devices.

## Что изменено

### Admin routes

- Добавлен `lib/admin-security.js` с единым admin guard для чувствительных admin-действий.
- DFSN export переведён на `requireAdminRequest(..., { exportAction: true })`.
- Admin export теперь получает отдельный rate limit `admin_export`.
- Admin JSON/CSV ответы получили явный `Cache-Control: no-store`.
- Исправлены routes со статусами, где `params` могли использоваться без `await` в Next 16.
- Admin write responses получили явный `no-store`.

### Recovery без email/phone

- Добавлен одноразовый `completion_token` для generic recovery flow.
- `POST /api/auth/recovery/submit-answers` теперь выдаёт `completion_token` после успешной проверки.
- `POST /api/auth/recovery/complete` теперь требует `completion_token`, а не только `recovery_id`.
- Recovery complete получил отдельный rate limit `auth_recovery_complete`.
- Direct recovery routes по backup/secret/phrase/trusted-device теперь сбрасывают старые сессии пользователя перед выдачей новой.
- Старые direct recovery routes по backup/secret/support получили rate limit.
- Recovery status/questions отдают `Cache-Control: no-store`.

### Passkey и trusted devices

- Исправлен дубль `where` в `lib/passkeys.js`.
- Отключение passkey теперь требует подтверждения текущим паролем.
- Установка/обновление PIN доверенного устройства теперь требует текущий пароль.
- Отключение доверенного устройства теперь требует текущий пароль.
- Settings UI теперь спрашивает пароль для отключения passkey, установки PIN и удаления устройства.
- Device GET routes теперь отдают `Cache-Control: no-store`.

### Static audit guardrail

Добавлен новый аудит:

```bash
npm run audit:sensitive-routes
```

Он сканирует:

- `app/api/admin`
- `app/api/auth/recover`
- `app/api/auth/recovery`
- `app/api/auth/passkeys`
- `app/api/devices`

И создаёт:

- `docs/sensitive-routes-audit.md`
- `docs/sensitive-routes-audit.json`

На момент прохода аудит показывает: `0 flagged / 32 scanned`.

## Новые rate limit policies

- `auth_recovery_complete`
- `admin_read`
- `admin_write`
- `admin_export`
- `device_sensitive`

## Важное поведение

Generic recovery flow теперь двухфазный:

1. `request` создаёт `recovery_id`.
2. `submit-answers` подтверждает метод и возвращает `completion_token`.
3. `complete` принимает `recovery_id + completion_token + new_password`.

Это защищает recovery-complete от сценария, где одного утёкшего `recovery_id` достаточно для завершения сброса пароля.

## Что ещё надо проверить вручную

- UI generic recovery flow, если он будет добавлен отдельной страницей, должен сохранить `completion_token` только в памяти формы и передать его в `/api/auth/recovery/complete`.
- Для production желательно заменить `window.prompt` в Settings на красивую secure modal-form.
- Admin routes позже стоит перевести все на `requireAdminRequest`, а не только самые чувствительные export/write сценарии.

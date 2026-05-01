# Passkey / WebAuthn без email и телефона

Этот проход добавляет полноценный passkey-флоу поверх философии Friendscape: сервис не собирает email и телефон, поэтому надёжный вход и восстановление строятся на локальных ключах устройства.

## Что добавлено

### Backend

- `lib/passkeys.js` — WebAuthn helper без новых npm-зависимостей.
- Минимальный CBOR parser для attestationObject/COSE public key.
- Поддержка ES256/P-256 passkeys.
- Проверка:
  - challenge;
  - origin;
  - RP ID hash;
  - user presence;
  - ECDSA signature при входе;
  - одноразовость challenge.
- `PasskeyChallenge` в Prisma для короткоживущих registration/authentication challenges.
- Сохранение passkeys в `AccountPasskey`.

### API

- `POST /api/auth/passkeys/register/options`
- `POST /api/auth/passkeys/register/verify`
- `POST /api/auth/passkeys/authenticate/options`
- `POST /api/auth/passkeys/authenticate/verify`
- `GET /api/auth/passkeys`
- `DELETE /api/auth/passkeys/[id]`

### UI

- Кнопка **Войти по passkey** на странице входа.
- Блок **Passkey** в настройках безопасности:
  - добавить passkey;
  - увидеть список passkeys;
  - отключить passkey.
- Страница `/recover/passkey`.
- Карточка восстановления через passkey на `/forgot-password`.

## Конфигурация

В `.env` можно задать:

```env
PASSKEY_RP_NAME="Friendscape"
PASSKEY_RP_ID="example.com"
PASSKEY_ORIGIN="https://example.com"
PASSKEY_ALLOWED_ORIGINS="https://example.com,https://www.example.com"
PASSKEY_USER_VERIFICATION="preferred"
```

`PASSKEY_RP_ID` — домен без протокола и порта. Для локальной разработки можно оставить пустым, сервер возьмёт hostname текущего запроса.

## Ограничения

- Поддерживается ES256/P-256 — это стандартный сценарий для большинства passkeys.
- Attestation не используется для vendor trust; режим по смыслу `attestation: none`.
- Для продакшена нужно выставить корректные `PASSKEY_RP_ID` и `PASSKEY_ORIGIN`.

## Проверка после установки

```bash
npx prisma generate
npx prisma db push
npm run dev
```

Потом:

1. Войти по паролю.
2. Открыть `Настройки → Безопасность`.
3. Добавить passkey, введя текущий пароль.
4. Выйти.
5. Войти с главной страницы по passkey.
6. Проверить `/recover/passkey`.

# Rate limit + anti-abuse pass

Этот проход добавляет базовую защиту Friendscape от спама и перебора без сбора email или телефона.

## Что добавлено

- `lib/anti-abuse.js` — единый rate-limit слой.
- Prisma-модель `RateLimitBucket` — счётчики лимитов в базе.
- Prisma-модель `AbuseEvent` — журнал срабатываний лимитов.
- `npm run cleanup:rate-limits` — очистка старых bucket-записей.

## Покрытые зоны

- вход по паролю;
- регистрация;
- recovery-фраза;
- trusted-device recovery;
- passkey options / verify / register;
- создание постов профиля;
- комментарии;
- отправка сообщений;
- загрузка медиа в чат, профиль, stories и сообщества;
- создание stories;
- создание сообщества;
- вступление/заявки в сообщество;
- посты сообщества;
- invite-коды сообщества;
- заявки в друзья;
- жалобы;
- обращения в поддержку.

## Философия без email/phone

Лимиты строятся на внутренних сигналах:

- user id после входа;
- IP / proxy headers до входа;
- username-like normalized key для login/register/recovery;
- device/session context, где он уже есть;
- внутренние audit logs.

Email и телефон не требуются.

## Поведение

Если лимит превышен, API возвращает:

```json
{
  "error": "Слишком много действий. Попробуйте чуть позже.",
  "code": "RATE_LIMITED",
  "retry_after": 300,
  "policy": "chat_message_send"
}
```

Также выставляются заголовки:

- `Retry-After`
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

## Важные лимиты

- `auth_login`: 8 попыток / 15 минут.
- `auth_register`: 4 попытки / час.
- `auth_recovery`: 5 попыток / 30 минут.
- `chat_message_send`: 90 сообщений / минуту.
- `post_create`: 20 постов / 10 минут.
- `comment_create`: 40 комментариев / 10 минут.
- `community_create`: 3 сообщества / сутки.
- `story_create`: 20 моментов / сутки.
- `support_ticket_create`: 5 обращений / сутки.

## Продакшен-заметка

Сейчас счётчики сохраняются в PostgreSQL через Prisma. Если БД временно недоступна, есть fallback на память процесса, чтобы приложение не падало.

Для горизонтального масштабирования лучше оставить общий PostgreSQL или позже заменить реализацию в `lib/anti-abuse.js` на Redis-счётчики.

## После установки

```bash
npx prisma generate
npx prisma db push
npm run dev
```

Периодически можно запускать:

```bash
npm run cleanup:rate-limits
```

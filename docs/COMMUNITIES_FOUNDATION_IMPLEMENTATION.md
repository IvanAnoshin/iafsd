# Communities foundation implementation

Этот проход переводит сообщества из декоративного уровня в рабочий фундамент.

## Добавлено

- Расширенная Prisma-модель `Community`.
- Роли участников через `CommunityMember`: `owner`, `admin`, `moderator`, `member`.
- Заявки на вступление через `CommunityJoinRequest`.
- Внутренние инвайт-коды через `CommunityInvite` без email и телефона.
- Правила сообщества через `CommunityRule`.
- Журнал действий сообщества через `CommunityModerationAction`.
- Пользовательское создание сообщества через `POST /api/communities`.
- Список сообществ через `GET /api/communities`.
- Детальная карточка через `GET /api/communities/[slug]`.
- Вступление, выход и заявка через `POST /api/communities/[slug]/membership`.
- Список заявок для модераторов через `GET /api/communities/[slug]/requests`.
- Принятие/отклонение заявки через `PATCH /api/communities/[slug]/requests/[requestId]`.
- Инвайт-коды через `GET/POST /api/communities/[slug]/invites`.
- Страницы `/communities` и `/communities/[slug]`.

## Философия идентификации

Сообщества не используют email и телефон. Приглашения построены на внутренних invite-кодах и действиях внутри Friendscape.

## Что ещё не делали в этом проходе

- Посты внутри сообществ.
- Медиа-раздел сообщества.
- Полная админ-панель настроек сообщества.
- Бан/мут участников.
- Принятие invite-кода отдельным публичным flow.
- Рекомендательная система сообществ.

## Что сделать после установки архива

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Для production позже надо заменить `db push` на миграции.

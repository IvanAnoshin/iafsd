# Communities production plan

Цель: превратить текущий минимальный модуль `Community + CommunityMember` в полноценные сообщества без использования email и телефонов.

## Философия

- Никаких email/phone в создании, приглашениях, заявках и восстановлении.
- Идентификация внутри продукта: user id, username/handle, имя, доверенные устройства, backup-коды, passkey.
- Все действия подтверждаются через внутренние уведомления, заявки, invite-коды и audit logs.

## Текущее состояние

Есть:

- `Community`;
- `CommunityMember`;
- публичный список `/api/communities`;
- поиск `/api/search/communities`;
- admin create `/api/admin/communities`;
- сериализация и простая поисковая логика в `lib/communities.js`.

Нет:

- пользовательского создания;
- страницы сообщества;
- заявок;
- invite-кодов;
- правил;
- постов в сообществах;
- модерации;
- расширенных ролей;
- настроек приватности.

## Prisma: следующий слой моделей

Минимальный production MVP:

```prisma
model CommunityJoinRequest {
  id          Int      @id @default(autoincrement())
  communityId Int
  userId      Int
  message     String?
  status      String   @default("pending")
  reviewedById Int?
  reviewedAt  DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([communityId, userId, status])
  @@index([communityId, status, createdAt])
  @@index([userId, status, createdAt])
}

model CommunityInvite {
  id           Int      @id @default(autoincrement())
  communityId  Int
  code         String   @unique
  createdById  Int
  maxUses      Int?
  usedCount    Int      @default(0)
  expiresAt    DateTime?
  status       String   @default("active")
  createdAt    DateTime @default(now())

  @@index([communityId, status])
  @@index([expiresAt])
}

model CommunityRule {
  id          Int      @id @default(autoincrement())
  communityId Int
  title       String
  body        String?
  position    Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([communityId, position])
}

model CommunityModerationAction {
  id          Int      @id @default(autoincrement())
  communityId Int
  actorId     Int
  targetUserId Int?
  targetType  String?
  targetId    String?
  action      String
  reason      String?
  metadata    Json?
  createdAt   DateTime @default(now())

  @@index([communityId, createdAt])
  @@index([actorId, createdAt])
}
```

Расширение `Community`:

- `ownerId`;
- `coverUrl`;
- `rulesText` или отдельная таблица rules;
- `postingPolicy`;
- `commentPolicy`;
- `joinPolicy`;
- `membersVisibility`;
- `showInRecommendations`;
- `allowFeedDistribution`.

## API MVP

Публичные и пользовательские:

- `GET /api/communities` — список доступных сообществ;
- `POST /api/communities` — создать сообщество;
- `GET /api/communities/[slug]` — карточка/страница;
- `PATCH /api/communities/[slug]` — настройки, только owner/admin;
- `POST /api/communities/[slug]/join` — вступить или подать заявку;
- `POST /api/communities/[slug]/leave` — выйти;
- `GET /api/communities/[slug]/members` — список участников с учётом privacy;
- `GET /api/communities/[slug]/requests` — заявки, только mod+;
- `POST /api/communities/[slug]/requests/[id]/accept`;
- `POST /api/communities/[slug]/requests/[id]/reject`;
- `POST /api/communities/[slug]/invites` — создать invite-code, mod+;
- `POST /api/communities/join-by-code` — вступить по коду.

Посты:

- `GET /api/communities/[slug]/posts`;
- `POST /api/communities/[slug]/posts`;
- `PATCH /api/communities/[slug]/posts/[postId]`;
- `DELETE /api/communities/[slug]/posts/[postId]`.

Модерация:

- `POST /api/communities/[slug]/members/[userId]/mute`;
- `POST /api/communities/[slug]/members/[userId]/ban`;
- `DELETE /api/communities/[slug]/members/[userId]`;
- `GET /api/communities/[slug]/moderation-log`.

## UI MVP

Страницы:

- `/communities` — список и поиск;
- `/communities/create` — создание;
- `/c/[slug]` — страница сообщества;
- `/c/[slug]/settings` — настройки, owner/admin;
- `/c/[slug]/requests` — заявки, mod+;
- `/c/[slug]/members` — участники.

На странице сообщества:

- cover/avatar;
- name/slug;
- member count;
- visibility badge;
- join/leave/request button;
- tabs: Лента, О сообществе, Участники, Правила, Модерация;
- composer, если viewer может публиковать;
- pinned/rules block.

## Permissions MVP

Роли:

- `owner`;
- `admin`;
- `moderator`;
- `member`.

Backend helpers:

- `getCommunityBySlug(slug)`;
- `getCommunityMembership(userId, communityId)`;
- `canViewCommunity(user, community)`;
- `canJoinCommunity(user, community)`;
- `canPostInCommunity(user, community, membership)`;
- `canModerateCommunity(user, community, membership)`;
- `canManageCommunity(user, community, membership)`.

Правило: frontend может скрывать кнопки, но backend обязан проверять каждое действие.

## Anti-abuse без email/phone

- лимит создания сообществ на аккаунт;
- лимит заявок в сутки;
- лимит invite-кодов;
- лимит публикаций для новых/подозрительных аккаунтов;
- DFSN risk check перед созданием публичного сообщества;
- trust score устройства;
- история жалоб;
- возраст аккаунта;
- мут/бан внутри сообщества.

## Порядок реализации

1. Расширить schema и helpers.
2. Добавить user-facing create/list/detail API.
3. Добавить страницы `/communities` и `/c/[slug]`.
4. Добавить join/leave.
5. Добавить роли и settings.
6. Добавить requests/invites.
7. Добавить community posts.
8. Добавить moderation log и bans/mutes.
9. Подключить сообщества к ленте и профилю.
10. Покрыть e2e тестами.

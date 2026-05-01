# Friendscape production deployment, KISS edition

Цель этого runbook — поднять проект предсказуемо: build отдельно, миграции отдельно, запуск отдельно.

## 1. Минимальный сервер

- Ubuntu 22.04+ или похожий Linux.
- Node.js 20+.
- PostgreSQL 16+.
- Nginx + HTTPS сертификат.
- Отдельный bucket / object storage для production media.

## 2. Первый деплой

```bash
cd /var/www/friendscape-next
npm ci
cp .env.production.example .env.production
nano .env.production
```

Заполни минимум:

- `DATABASE_URL`
- `APP_PUBLIC_URL`
- `CSRF_TRUSTED_ORIGINS`
- `PASSKEY_RP_ID`
- `PASSKEY_ORIGIN`
- `STORAGE_*` или отдельные `*_MEDIA_*` переменные
- `ADMIN_USER_IDS` или `ADMIN_USER_KEYS` после создания админа

Проверка env:

```bash
set -a
. ./.env.production
set +a
NODE_ENV=production npm run check:env
```

## 3. Сборка

```bash
set -a
. ./.env.production
set +a
NODE_ENV=production npm run build:prod
```

`build:prod` не делает `prisma db push` и не должен менять production-базу.

## 4. Миграции базы

Перед миграциями сделай backup. Затем:

```bash
set -a
. ./.env.production
set +a
NODE_ENV=production npm run deploy:migrate
```

В production используется только `prisma migrate deploy`. `prisma db push` заблокирован при `NODE_ENV=production`.

## 5. Запуск

Вариант вручную:

```bash
set -a
. ./.env.production
set +a
NODE_ENV=production PORT=3000 npm run start:prod
```

Вариант systemd:

```bash
sudo cp deploy/friendscape-next.service /etc/systemd/system/friendscape-next.service
sudo systemctl daemon-reload
sudo systemctl enable friendscape-next
sudo systemctl start friendscape-next
sudo systemctl status friendscape-next
```

## 6. Nginx

Используй `deploy/nginx/friendscape-next.conf` как основу. Замени:

- `friendscape.example.com`
- пути к сертификатам
- upstream port, если он не `3000`

Проверка:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Проверки после запуска

```bash
curl -fsS https://friendscape.example.com/api/version
curl -fsS https://friendscape.example.com/api/ready
NODE_ENV=production npm run verify:launch
```

Ручной smoke:

1. Открыть `/`.
2. Зарегистрироваться без email/phone.
3. Войти и выйти.
4. Открыть feed, profile, people, chat, communities, settings.
5. Создать пост.
6. Отправить сообщение.
7. Загрузить media.
8. Открыть moderation/admin только под admin.

## 8. Обновление версии

```bash
cd /var/www/friendscape-next
git pull
npm ci
set -a
. ./.env.production
set +a
NODE_ENV=production npm run check:env
NODE_ENV=production npm run build:prod
# backup DB here
NODE_ENV=production npm run deploy:migrate
sudo systemctl restart friendscape-next
curl -fsS https://friendscape.example.com/api/ready
```

## 9. Rollback минимум

1. Остановить app.
2. Вернуть предыдущий git tag / архив.
3. `npm ci`.
4. Вернуть backup базы, если миграция несовместима.
5. Запустить app.
6. Проверить `/api/ready`.

Подробный backup/restore описан в `docs/BACKUP_RESTORE.md`.

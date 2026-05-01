# Friendscape: быстрый запуск на Ubuntu + Nginx

## 1. Подготовка сервера
- Ubuntu 22.04+
- Node.js 20+
- PostgreSQL 16+
- Nginx

## 2. Переменные окружения
Скопируй `.env.example` в `.env.production` и заполни минимум:
- `DATABASE_URL`
- `APP_PUBLIC_URL`
- `SESSION_COOKIE_SECURE=true`
- `ADMIN_USER_IDS` или `ADMIN_USER_KEYS`

## 3. Сборка
```bash
npm ci
NODE_ENV=production npm run build:prod
```

## 4. Запуск
```bash
NODE_ENV=production PORT=3000 npm run start:prod
```

## 5. Nginx
Используй `deploy/nginx/friendscape-next.conf` как основу виртуального хоста.

## 6. systemd или pm2
В `deploy/friendscape-next.service` есть пример systemd unit.
В `deploy/ecosystem.config.cjs` есть пример для pm2.

## 7. Проверки после запуска
- `GET /api/ready`
- `GET /api/version`
- логин
- feed
- people
- chat
- settings

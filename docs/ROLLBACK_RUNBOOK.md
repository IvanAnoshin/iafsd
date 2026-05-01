# Rollback runbook

Цель: быстро и безопасно откатить релиз, если после деплоя появились критичные ошибки.

## Когда откатывать

- health/ready не проходят;
- массовые 5xx;
- вход/регистрация/чат/лента сломаны;
- миграция испортила критичный сценарий;
- storage/realtime недоступны;
- security-риск обнаружен после релиза.

## Перед откатом

```bash
NODE_ENV=production npm run rollback:check
```

Проверь:

- есть backup до миграции;
- известен предыдущий commit/tag;
- понятно, нужен ли restore базы или достаточно отката кода;
- есть доступ к systemd/pm2 и базе.

## Откат только кода

Подходит, если миграции не меняли данные опасно или совместимы назад.

```bash
sudo systemctl stop friendscape-next
git checkout <previous_release_tag_or_commit>
npm ci
set -a
. ./.env.production
set +a
NODE_ENV=production npm run check:env
NODE_ENV=production npm run build:prod
sudo systemctl start friendscape-next
curl -fsS "$APP_PUBLIC_URL/api/health"
NODE_ENV=production npm run verify:launch
NODE_ENV=production npm run monitor:alerts
```

## Откат кода + restore базы

Подходит, если новая миграция или код испортили данные.

```bash
sudo systemctl stop friendscape-next
git checkout <previous_release_tag_or_commit>
npm ci
set -a
. ./.env.production
set +a
NODE_ENV=production npm run check:env
NODE_ENV=production npm run build:prod
NODE_ENV=production npm run restore:db -- --file=/var/backups/friendscape/db/<backup.dump> --yes
sudo systemctl start friendscape-next
curl -fsS "$APP_PUBLIC_URL/api/health"
NODE_ENV=production npm run verify:launch
NODE_ENV=production npm run monitor:alerts
```

## После отката

1. Зафиксировать причину.
2. Не запускать тот же релиз повторно без staging-проверки.
3. Сохранить логи и backup-id.
4. Создать короткий incident note в документации или issue tracker.

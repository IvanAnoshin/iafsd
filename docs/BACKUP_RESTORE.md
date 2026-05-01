# Backup / restore / cleanup ops

v85 добавляет рабочие команды для эксплуатации. Правило безопасности: backup можно запускать сразу, destructive restore и cleanup запускаются только явно.

## Что обязательно сохранять

1. PostgreSQL database.
2. `.env.production` — хранить отдельно и не класть в git.
3. Object storage bucket или `public/uploads`, если включён local storage.
4. Текущий release archive / git tag.

## Переменные

Минимум в `.env.production`:

```bash
DATABASE_URL="postgresql://..."
BACKUP_DIR=/var/backups/friendscape/db
BACKUP_RETENTION_DAYS=14
BACKUP_PRUNE_AFTER_SUCCESS=true
```

Опционально, если бинарники PostgreSQL лежат не в PATH:

```bash
PG_DUMP_BIN=/usr/bin/pg_dump
PG_RESTORE_BIN=/usr/bin/pg_restore
PSQL_BIN=/usr/bin/psql
```

## Backup базы

Проверить, что команда видит настройки, но ничего не создаёт:

```bash
npm run backup:db:dry-run
```

Создать backup:

```bash
npm run backup:db
```

Создать backup и удалить старые `.dump/.sql` по `BACKUP_RETENTION_DAYS`:

```bash
npm run backup:db:prune
```

Backup создаётся в custom format PostgreSQL: `friendscape-db-YYYY-MM-DDTHH-MM-SS.dump`. Рядом пишется manifest `.json` с размером и временем создания.

## Restore базы

Сначала dry-run:

```bash
npm run restore:db -- --file=/var/backups/friendscape/db/friendscape-prod-db-YYYY.dump --dry-run
```

Реальный restore destructive. Перед ним останови приложение и сделай свежий backup.

```bash
sudo systemctl stop friendscape-next
npm run restore:db -- --file=/var/backups/friendscape/db/friendscape-prod-db-YYYY.dump --yes-i-understand
npm run deploy:migrate
sudo systemctl start friendscape-next
npm run verify:launch
```

Для `.dump` используется `pg_restore --clean --if-exists --no-owner --no-acl`. Для `.sql` используется `psql --file`.

## Cron пример

Открой crontab пользователя, от которого обслуживается проект:

```bash
crontab -e
```

Пример ежедневного backup и cleanup в 03:15:

```cron
15 3 * * * cd /var/www/friendscape-next && /usr/bin/npm run backup:db:prune >> /var/log/friendscape-backup.log 2>&1
35 3 * * * cd /var/www/friendscape-next && /usr/bin/npm run cleanup:ops:delete >> /var/log/friendscape-cleanup.log 2>&1
```

Для первого запуска лучше заменить `cleanup:ops:delete` на `cleanup:ops` и посмотреть dry-run отчёт.

## Cleanup данных

Dry-run всех безопасных cleanup-задач:

```bash
npm run cleanup:ops
```

Реальное удаление:

```bash
npm run cleanup:ops:delete
```

Внутри запускается:

- `cleanup:expired` — expired sessions, passkey challenges, recovery sessions, invites, old read notifications, old abuse/audit/DFSN rows, stale chat drafts;
- `cleanup:rate-limits` — старые buckets, теперь тоже dry-run по умолчанию;
- `cleanup:media` — orphan local media и stale stories, dry-run по умолчанию.

Для object storage scan:

```bash
npm run cleanup:ops -- --object
npm run cleanup:ops:delete -- --object
```

## Тонкая настройка retention

```bash
RATE_LIMIT_CLEANUP_OLDER_THAN_HOURS=48
NOTIFICATION_CLEANUP_READ_DAYS=90
ABUSE_EVENT_CLEANUP_DAYS=90
AUDIT_LOG_CLEANUP_DAYS=365
DFSN_SESSION_CLEANUP_DAYS=180
CHAT_DRAFT_CLEANUP_DAYS=30
STORY_MEDIA_CLEANUP_STALE_HOURS=72
```

## Local media backup

Local production media разрешён только если явно включены `*_MEDIA_ALLOW_LOCAL_IN_PRODUCTION=true`. Если такой режим используется:

```bash
tar -czf "/var/backups/friendscape/uploads-$(date +%Y%m%d-%H%M%S).tar.gz" \
  -C /var/www/friendscape-next public/uploads
```

## Object storage backup

Лучше использовать возможности provider-а:

- bucket versioning;
- lifecycle rules;
- отдельный readonly/list ключ для аудита;
- отдельный ключ для backup/restore;
- ограниченные delete permissions для app key.

## Минимальная проверка backup

Раз в неделю восстанови backup в staging/local database:

```bash
DATABASE_URL="postgresql://...staging..." npm run restore:db -- --file=/path/to/backup.dump --dry-run
DATABASE_URL="postgresql://...staging..." npm run restore:db -- --file=/path/to/backup.dump --yes-i-understand
DATABASE_URL="postgresql://...staging..." npm run deploy:migrate
```

## Важно

Не запускай restore поверх production с работающим приложением. Сначала останови сервис, восстанови базу, прогони миграции, затем запусти приложение обратно.

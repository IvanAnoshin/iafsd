# v85 — Backup / Restore / Cleanup Ops

## Цель

Сделать эксплуатацию Friendscape безопасной: данные можно сохранить, восстановить и регулярно чистить. Реализация KISS: несколько понятных node-скриптов, dry-run по умолчанию для cleanup, destructive действия только с явным флагом.

## Что добавлено

### Backup

- `scripts/backup-db.mjs`
- `npm run backup:db`
- `npm run backup:db:dry-run`
- `npm run backup:db:prune`

Backup использует `pg_dump --format=custom --no-owner --no-acl` и пишет manifest рядом с `.dump`.

### Restore

- `scripts/restore-db.mjs`
- `npm run restore:db`

Restore требует `--file=...`. Реальное восстановление требует `--yes-i-understand`.

### Cleanup

- `scripts/cleanup-expired-data.mjs`
- `scripts/cleanup-ops.mjs`
- `cleanup-rate-limits` переведён на dry-run по умолчанию

Команды:

```bash
npm run cleanup:expired
npm run cleanup:expired:delete
npm run cleanup:rate-limits
npm run cleanup:rate-limits:delete
npm run cleanup:ops
npm run cleanup:ops:delete
```

`cleanup:ops` запускает expired-data, rate-limits и media cleanup одним проходом.

## Что чистится

- expired `Session`;
- expired `PasskeyChallenge`;
- expired pending `RecoverySession`;
- expired `CommunityInvite`;
- old read `Notification`;
- old `AbuseEvent`;
- old `AuditLog`;
- old `DfsnSession`;
- expired `ConversationTypingState`;
- stale chat drafts;
- orphan media через существующий `cleanup-media`;
- stale story media.

## Safety

- cleanup dry-run по умолчанию;
- delete только через `--delete`;
- restore только через `--yes-i-understand`;
- backup не печатает сырой `DATABASE_URL`;
- `backups/` и `.dump` добавлены в `.gitignore`.

## Env

Добавлены в `.env.example` и `.env.production.example`:

```bash
BACKUP_DIR=/var/backups/friendscape/db
BACKUP_RETENTION_DAYS=14
BACKUP_PRUNE_AFTER_SUCCESS=true
BACKUP_NAME_PREFIX=friendscape-prod-db
PG_DUMP_BIN=pg_dump
PG_RESTORE_BIN=pg_restore
PSQL_BIN=psql
NOTIFICATION_CLEANUP_READ_DAYS=90
ABUSE_EVENT_CLEANUP_DAYS=90
AUDIT_LOG_CLEANUP_DAYS=365
DFSN_SESSION_CLEANUP_DAYS=180
CHAT_DRAFT_CLEANUP_DAYS=30
```

## Проверки

```bash
node --check scripts/backup-db.mjs
node --check scripts/restore-db.mjs
node --check scripts/cleanup-expired-data.mjs
node --check scripts/cleanup-rate-limits.mjs
node --check scripts/cleanup-ops.mjs
node scripts/backup-db.mjs --dry-run --env-file=.env.example
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"
```

`npm run build` не запускался в проходе v85: архив не содержит `node_modules`.

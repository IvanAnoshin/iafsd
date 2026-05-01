# Release pipeline report

Generated: 2026-04-26T18:46:37.325Z

Status: **ready**

| Status | Check | Detail |
|---|---|---|
| ok | .env.example | present |
| ok | .env.staging.example | present |
| ok | .env.production.example | present |
| ok | scripts/release-check.mjs | present |
| ok | scripts/rollback-check.mjs | present |
| ok | scripts/check-release-pipeline.mjs | present |
| ok | docs/RELEASE_RUNBOOK.md | present |
| ok | docs/ROLLBACK_RUNBOOK.md | present |
| ok | docs/STAGING_RELEASE_PIPELINE_V96.md | present |
| ok | deploy/staging/friendscape-next-staging.service | present |
| ok | deploy/staging/ecosystem.staging.config.cjs | present |
| ok | deploy/staging/nginx-staging.conf | present |
| ok | script:check:env | node scripts/check-env.mjs |
| ok | script:check:staging | node scripts/check-env.mjs --env-file=.env.staging.example |
| ok | script:release:check | node scripts/check-release-pipeline.mjs |
| ok | script:release:staging | node scripts/release-check.mjs --target=staging --env-file=.env.staging.example |
| ok | script:release:prod | node scripts/release-check.mjs --target=production --env-file=.env.production.example |
| ok | script:rollback:check | node scripts/rollback-check.mjs |
| ok | script:backup:db | node scripts/backup-db.mjs |
| ok | script:deploy:migrate | node scripts/migrate-prod.mjs |
| ok | script:smoke:e2e | node scripts/smoke-e2e.mjs |
| ok | script:monitor:alerts | node scripts/check-monitoring-alerts.mjs |
| ok | staging_env:APP_ENV | staging |
| ok | staging_env:APP_RELEASE_CHANNEL | staging |
| ok | staging_env:APP_PUBLIC_URL | https://staging.friendscape.example.com |
| ok | staging_env:separate_storage | uses staging bucket/prefix |
| ok | production_env:APP_ENV | production |
| ok | production_env:APP_RELEASE_CHANNEL | production |
| ok | release_runbook:release_order | present |
| ok | rollback_runbook:backup_path | present |
| ok | v96_doc:pipeline_flow | present |
| ok | migrate_prod:uses_migrate_deploy | present |
| ok | prisma_push:blocked_in_production | present |
| ok | version_api:release_metadata | present |


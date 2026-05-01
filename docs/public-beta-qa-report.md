# Public beta QA report

Generated: 2026-04-28T09:17:48.362Z

Status: **ready**

| Status | Check | Detail |
|---|---|---|
| ok | app/feedback/page.jsx | present |
| ok | app/settings/page.jsx | present |
| ok | app/chat/page.jsx | present |
| ok | components/PostAuthBottomNav.jsx | present |
| ok | lib/support.js | present |
| ok | docs/PUBLIC_BETA_QA_V97.md | present |
| ok | docs/PUBLIC_BETA_RELEASE_NOTES.md | present |
| ok | script:beta:qa | node scripts/public-beta-qa.mjs |
| ok | script:verify:launch | node scripts/verify-launch.mjs |
| ok | script:qa:alpha | node scripts/alpha-qa.mjs |
| ok | script:smoke:e2e | node scripts/smoke-e2e.mjs |
| ok | script:security:check | node scripts/check-security-pass.mjs |
| ok | script:release:check | node scripts/check-release-pipeline.mjs |
| ok | script:rollback:check | node scripts/rollback-check.mjs |
| ok | feedback_page:csrf_and_status | present |
| ok | bottom_nav:feedback_entry_removed | no feedback entry in bottom nav |
| ok | settings:feedback_entry | present |
| ok | settings:support_beta_categories | present |
| ok | feed:read_only_aggregator | posting composer removed from feed |
| ok | support:safe_context | present |
| ok | proxy:feedback_protected | present |
| ok | headers:feedback_no_store | present |
| ok | smoke:feedback_page | present |
| ok | chat:debug_disabled_in_production | present |
| ok | chat:no_fake_fallback_seed | no demo fallback chat seed |
| ok | runtime:no_console_log | no stray console.log in app/components runtime |
| ok | production_env:no_localhost | no localhost/dev DB defaults |
| ok | production_env:release_channel | production |
| ok | docs/RELEASE_RUNBOOK.md | present |
| ok | docs/ROLLBACK_RUNBOOK.md | present |
| ok | docs/ALPHA_RELEASE_NOTES.md | present |
| ok | beta_release_notes:limitations_and_feedback | present |
| ok | beta_qa:critical_scenarios | present |


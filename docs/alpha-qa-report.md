# Alpha QA report

Generated: 2026-04-28T09:17:50.133Z

Status: **ready**

## Checks

| Status | Check | Detail |
|---|---|---|
| ok | required_pages | 18 pages present |
| ok | required_docs | 18 docs present |
| ok | script:verify:launch | present |
| ok | script:audit:placeholders | present |
| ok | script:audit:access-control | present |
| ok | script:audit:sensitive-routes | present |
| ok | script:smoke:e2e | present |
| ok | script:qa:alpha | present |
| ok | script:account:deletions | present |
| ok | script:monitor:alerts | present |
| ok | script:realtime:check | present |
| ok | script:storage:check | present |
| ok | script:performance:check | present |
| ok | script:accessibility:check | present |
| ok | script:security:check | present |
| ok | script:release:check | present |
| ok | script:rollback:check | present |
| ok | script:beta:qa | present |
| ok | proxy:/profile | protected |
| ok | proxy:/feed | protected |
| ok | proxy:/chat | protected |
| ok | proxy:/people | protected |
| ok | proxy:/settings | protected |
| ok | proxy:/feedback | protected |
| ok | proxy:/communities | protected |
| ok | proxy:/stories | protected |
| ok | proxy_no_store | protected pages add no-store headers |
| ok | api_no_store | api responses have no-store header |
| ok | page_no_store | core pages have no-store header rule |
| ok | csrf_write_routes | all non-exempt write routes have CSRF guard |
| ok | native_dialogs | no alert/confirm/prompt calls in runtime |
| ok | runtime_seeds | no ungated runtime seed data detected |


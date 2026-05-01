# Security pass report

Generated: 2026-04-26T18:46:37.130Z

Status: **ready**

| Status | Check | Detail |
|---|---|---|
| ok | file:lib/media-security.js | present |
| ok | file:lib/url-safety.js | present |
| ok | file:lib/chat.js | present |
| ok | file:lib/posts.js | present |
| ok | file:lib/communities.js | present |
| ok | file:lib/stories.js | present |
| ok | file:app/api/feed/posts/route.js | present |
| ok | file:app/api/profile/posts/route.js | present |
| ok | file:next.config.js | present |
| ok | upload_sniffing | upload signature checks are present |
| ok | media_reference_scope_guard | media references are checked against registry/scope |
| ok | server_media_url_sanitizer | server media URL sanitizer present |
| ok | media_guard:app/api/feed/posts/route.js | present |
| ok | media_guard:app/api/profile/posts/route.js | present |
| ok | media_guard:lib/communities.js | present |
| ok | media_guard:lib/chat.js | present |
| ok | media_guard:lib/stories.js | present |
| ok | client_url_safety:app/feed/page.jsx | present |
| ok | client_url_safety:app/communities/[slug]/page.jsx | present |
| ok | client_url_safety:app/chat/components/ChatConversationWorkspace.jsx | present |
| ok | csrf_error_shape | all CSRF failures return verifyCsrf response object |
| ok | csp_prod_no_unsafe_eval | unsafe-eval is limited to non-production branch |
| ok | csp_upgrade_insecure_requests | production CSP upgrades insecure requests |
| ok | dangerous_inner_html | only allowlisted bootstrap script uses dangerouslySetInnerHTML |

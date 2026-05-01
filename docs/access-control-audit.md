# Access Control Audit

Generated at: 2026-04-26T18:26:54.525Z

## Summary

- Needs review: 52
- Reviewed or guarded: 70

## Findings

| Status | Pattern | File | Line | Note |
|---|---|---:|---:|---|
| needs_review | route-param-id | `app/api/auth/passkeys/[id]/route.js` | 25 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | raw-id-findUnique | `app/api/auth/recovery/complete/route.js` | 62 | findUnique by raw id should be paired with owner/member/access check. |
| needs_review | route-param-id | `app/api/communities/[slug]/comments/[commentId]/route.js` | 16 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/communities/[slug]/invites/route.js` | 12 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/communities/[slug]/media/route.js` | 11 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/communities/[slug]/members/[memberId]/route.js` | 16 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/communities/[slug]/membership/route.js` | 22 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/communities/[slug]/moderation/route.js` | 11 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/communities/[slug]/posts/[postId]/route.js` | 16 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/communities/[slug]/posts/route.js` | 15 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/communities/[slug]/requests/[requestId]/route.js` | 16 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/communities/[slug]/requests/route.js` | 10 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/communities/[slug]/route.js` | 13 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/communities/[slug]/similar/route.js` | 10 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/devices/[deviceId]/pin/route.js` | 27 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/devices/[deviceId]/route.js` | 16 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/friends/[id]/accept/route.js` | 8 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/friends/[id]/reject/route.js` | 7 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/friends/[id]/request/route.js` | 9 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/friends/[id]/route.js` | 7 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | raw-id-findUnique | `app/api/people/route.js` | 279 | findUnique by raw id should be paired with owner/member/access check. |
| needs_review | raw-id-findUnique | `app/api/profile/posts/[postId]/route.js` | 28 | findUnique by raw id should be paired with owner/member/access check. |
| needs_review | route-param-id | `app/api/profile/posts/[postId]/route.js` | 22 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | json-payload-media | `app/api/profile/posts/[postId]/route.js` | 34 | Media in Json payload needs explicit post/story/community visibility checks. |
| needs_review | route-param-id | `app/api/reports/comments/[commentId]/route.js` | 25 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/reports/posts/[id]/route.js` | 19 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/stories/[id]/extend/route.js` | 14 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/stories/[id]/reaction/route.js` | 14 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/stories/[id]/reply/route.js` | 14 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/stories/[id]/route.js` | 13 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/stories/[id]/seen/route.js` | 13 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/users/[id]/communities/route.js` | 10 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/users/[id]/connections/route.js` | 36 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/users/[id]/friends/count/route.js` | 14 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/users/[id]/friends/route.js` | 12 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/users/[id]/online-status/route.js` | 17 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/users/[id]/presence/route.js` | 12 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/users/[id]/relationship/route.js` | 10 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/users/[id]/route.js` | 33 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/users/[id]/subscribe/route.js` | 8 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/users/[id]/subscribers/count/route.js` | 14 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/users/[id]/subscribers/route.js` | 12 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/users/[id]/subscriptions/count/route.js` | 14 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | route-param-id | `app/api/users/[id]/subscriptions/route.js` | 12 | Dynamic route should validate viewer access before returning or mutating data. |
| needs_review | json-payload-media | `lib/chat-media.js` | 253 | Media in Json payload needs explicit post/story/community visibility checks. |
| needs_review | json-payload-media | `lib/community-media.js` | 201 | Media in Json payload needs explicit post/story/community visibility checks. |
| needs_review | raw-id-findUnique | `lib/notifications.js` | 168 | findUnique by raw id should be paired with owner/member/access check. |
| needs_review | storage-proxy | `lib/object-storage.js` | 276 | Storage proxy must verify ownership/membership before redirect. |
| needs_review | json-payload-media | `lib/post-media.js` | 218 | Media in Json payload needs explicit post/story/community visibility checks. |
| needs_review | json-payload-media | `lib/profile-media.js` | 98 | Media in Json payload needs explicit post/story/community visibility checks. |
| needs_review | raw-id-findUnique | `lib/social.js` | 35 | findUnique by raw id should be paired with owner/member/access check. |
| needs_review | json-payload-media | `lib/story-media.js` | 218 | Media in Json payload needs explicit post/story/community visibility checks. |
| reviewed_or_guarded | route-param-id | `app/api/admin/reports/comments/[id]/status/route.js` | 8 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/admin/reports/messages/[id]/status/route.js` | 8 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/admin/reports/posts/[id]/status/route.js` | 8 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/admin/reports/targets/[id]/status/route.js` | 8 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/admin/safety-flags/[id]/status/route.js` | 8 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/admin/support/tickets/[id]/status/route.js` | 8 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/chat/calls/[id]/action/route.js` | 16 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/chat/calls/[id]/route.js` | 10 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/chat/calls/[id]/signal/route.js` | 13 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/chats/[id]/archive/route.js` | 17 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/chats/[id]/draft/route.js` | 8 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/chats/[id]/e2ee/route.js` | 10 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/chats/[id]/messages/route.js` | 18 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/chats/[id]/mute/route.js` | 17 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/chats/[id]/pin/route.js` | 17 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/chats/[id]/pins/route.js` | 11 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/chats/[id]/read/route.js` | 14 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/chats/[id]/search/route.js` | 12 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/chats/[id]/typing/route.js` | 12 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | raw-id-findUnique | `app/api/comments/[id]/route.js` | 102 | findUnique by raw id should be paired with owner/member/access check. |
| reviewed_or_guarded | route-param-id | `app/api/comments/[id]/route.js` | 21 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/comments/[id]/vote/route.js` | 22 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/communities/[slug]/media/upload/route.js` | 30 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | raw-id-findUnique | `app/api/feed/posts/[postId]/comments/route.js` | 52 | findUnique by raw id should be paired with owner/member/access check. |
| reviewed_or_guarded | route-param-id | `app/api/feed/posts/[postId]/comments/route.js` | 46 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | raw-id-findUnique | `app/api/feed/posts/[postId]/route.js` | 69 | findUnique by raw id should be paired with owner/member/access check. |
| reviewed_or_guarded | route-param-id | `app/api/feed/posts/[postId]/route.js` | 18 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | raw-id-findUnique | `app/api/feed/posts/[postId]/save/route.js` | 19 | findUnique by raw id should be paired with owner/member/access check. |
| reviewed_or_guarded | route-param-id | `app/api/feed/posts/[postId]/save/route.js` | 13 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/feed/posts/[postId]/share/route.js` | 79 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | raw-id-findUnique | `app/api/feed/posts/[postId]/vote/route.js` | 25 | findUnique by raw id should be paired with owner/member/access check. |
| reviewed_or_guarded | route-param-id | `app/api/feed/posts/[postId]/vote/route.js` | 13 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | json-payload-media | `app/api/feed/posts/route.js` | 57 | Media in Json payload needs explicit post/story/community visibility checks. |
| reviewed_or_guarded | route-param-id | `app/api/message-requests/[id]/accept/route.js` | 13 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/message-requests/[id]/block/route.js` | 13 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/message-requests/[id]/reject/route.js` | 13 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/messages/[id]/context/route.js` | 12 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/messages/[id]/pin/route.js` | 8 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/messages/[id]/reaction/route.js` | 8 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/messages/[id]/report/route.js` | 9 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/messages/[id]/route.js` | 8 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/messages/[id]/save/route.js` | 8 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/notifications/[id]/read/route.js` | 15 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | raw-id-findUnique | `app/api/posts/[id]/comments/route.js` | 52 | findUnique by raw id should be paired with owner/member/access check. |
| reviewed_or_guarded | route-param-id | `app/api/posts/[id]/comments/route.js` | 46 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | raw-id-findUnique | `app/api/posts/[id]/like/route.js` | 46 | findUnique by raw id should be paired with owner/member/access check. |
| reviewed_or_guarded | route-param-id | `app/api/posts/[id]/like/route.js` | 40 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/posts/[id]/route.js` | 15 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | json-payload-media | `app/api/profile/posts/route.js` | 94 | Media in Json payload needs explicit post/story/community visibility checks. |
| reviewed_or_guarded | route-param-id | `app/api/storage/chat/[...key]/route.js` | 43 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | storage-proxy | `app/api/storage/chat/[...key]/route.js` | 4 | Storage proxy must verify ownership/membership before redirect. |
| reviewed_or_guarded | raw-id-findUnique | `app/api/storage/community/[...key]/route.js` | 35 | findUnique by raw id should be paired with owner/member/access check. |
| reviewed_or_guarded | route-param-id | `app/api/storage/community/[...key]/route.js` | 30 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | storage-proxy | `app/api/storage/community/[...key]/route.js` | 5 | Storage proxy must verify ownership/membership before redirect. |
| reviewed_or_guarded | route-param-id | `app/api/storage/post/[...key]/route.js` | 24 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | storage-proxy | `app/api/storage/post/[...key]/route.js` | 3 | Storage proxy must verify ownership/membership before redirect. |
| reviewed_or_guarded | route-param-id | `app/api/storage/story/[...key]/route.js` | 24 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | storage-proxy | `app/api/storage/story/[...key]/route.js` | 3 | Storage proxy must verify ownership/membership before redirect. |
| reviewed_or_guarded | route-param-id | `app/api/users/[id]/media/route.js` | 15 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | route-param-id | `app/api/users/[id]/posts/route.js` | 19 | Dynamic route should validate viewer access before returning or mutating data. |
| reviewed_or_guarded | raw-id-findUnique | `lib/auth.js` | 193 | findUnique by raw id should be paired with owner/member/access check. |
| reviewed_or_guarded | raw-id-findUnique | `lib/chat-calls.js` | 192 | findUnique by raw id should be paired with owner/member/access check. |
| reviewed_or_guarded | raw-id-findUnique | `lib/chat.js` | 1033 | findUnique by raw id should be paired with owner/member/access check. |
| reviewed_or_guarded | json-payload-media | `lib/chat.js` | 123 | Media in Json payload needs explicit post/story/community visibility checks. |
| reviewed_or_guarded | raw-id-findUnique | `lib/communities.js` | 671 | findUnique by raw id should be paired with owner/member/access check. |
| reviewed_or_guarded | json-payload-media | `lib/communities.js` | 785 | Media in Json payload needs explicit post/story/community visibility checks. |
| reviewed_or_guarded | json-payload-media | `lib/media-security.js` | 158 | Media in Json payload needs explicit post/story/community visibility checks. |
| reviewed_or_guarded | json-payload-media | `lib/posts.js` | 31 | Media in Json payload needs explicit post/story/community visibility checks. |
| reviewed_or_guarded | raw-id-findUnique | `lib/reports.js` | 170 | findUnique by raw id should be paired with owner/member/access check. |
| reviewed_or_guarded | json-payload-media | `lib/stories.js` | 253 | Media in Json payload needs explicit post/story/community visibility checks. |

## Rule of thumb

Every route that accepts an id from URL/body must prove one of these before reading/mutating: owner, participant, active community member/moderator, admin, or public visibility.

# Profile/privacy cleanup

## Scope

This pass tightens profile privacy around public profile pages and related user endpoints.

## What changed

- Public profile UI now explicitly respects privacy restrictions:
  - restricted profile details show a neutral privacy message;
  - hidden activity shows `—` counters and disables connection list opening;
  - hidden media shows a dedicated empty state instead of an empty album;
  - hidden posts show a dedicated empty state instead of looking like an empty profile.
- `/api/users/[id]` now returns privacy flags for profile, activity, media and communities.
- `/api/users/[id]/posts` returns `restricted` and no-store headers.
- `/api/users/[id]/media` returns full zeroed counts when media is hidden.
- Connections and social-count routes now enforce `activity_visibility`:
  - `/api/users/[id]/connections`
  - `/api/users/[id]/friends`
  - `/api/users/[id]/subscribers`
  - `/api/users/[id]/subscriptions`
  - matching count routes.
- User search no longer ranks by hidden profile fields like bio, occupation or city.
- User search masks private profile details and activity counters according to viewer relationship.

## Notes

The project still keeps the no-email/no-phone philosophy. Privacy decisions are based on internal relations: self, friend, subscription/follower connection and user preferences.

## Verification

- `node --check` for changed server/lib files.
- JSX parse for `app/profile/[id]/page.jsx` through TypeScript transpile.
- `npm run audit:placeholders`.
- `npm run audit:access-control`.
- `npm run audit:sensitive-routes`.

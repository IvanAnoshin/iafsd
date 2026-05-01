# V150 — Feed stories removed

## Scope
- Removed the visible Moments/Stories rail from `app/feed/page.jsx`.
- Removed feed-only story loading from `/api/stories?source=feed&limit=8`.
- Removed unused feed imports for `StoriesFoundationRail` and `mapStoryToRailItem`.

## Not changed
- Messenger moments/stories were not changed in this pass.
- `/stories` route, story APIs, story libraries, Prisma and backend data were not removed.
- The feed post list, filters, comments and repost/share logic were not changed.

## Reason
Moments are moving out of the feed product surface and will be reintroduced in the messenger in a later small pass.

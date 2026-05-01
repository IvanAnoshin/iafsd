# V149 — communities direct routes disabled

Small KISS pass: communities are no longer available as user-facing pages.

## Changed

- `/communities` now redirects to `/feed`.
- `/communities/create` now redirects to `/feed`.
- `/communities/[slug]` now redirects to `/feed`.

## Not changed

- Community API routes are kept intact.
- Prisma schema and database models are kept intact.
- Existing community-related server utilities are kept intact.

This keeps the product UI clean while avoiding risky backend deletion during the transition to moments in messenger.

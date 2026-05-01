# v152 — Messenger moment create sheet

Small KISS pass.

- Kept moments inside Messenger.
- Replaced the create-ring redirect with an in-place bottom sheet in `/chat`.
- Added a minimal text/photo mode switch, live preview, caption field, publish state, and error state.
- Publishing now uses the existing `POST /api/stories` endpoint with `source: 'chat'`.
- Added a local rail refresh after successful publish so the new moment appears immediately.
- Did not change Prisma or add new backend models.

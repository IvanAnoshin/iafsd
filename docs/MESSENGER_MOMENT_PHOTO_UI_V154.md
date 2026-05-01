# V154 — Messenger moment photo UI

Small KISS pass for moment creation inside `/chat`.

## Changed

- Added local photo picker to the messenger moment creation sheet.
- Added image validation for photo drafts:
  - image MIME only;
  - max size 8 MB.
- Added local preview with cover image inside the moment preview card.
- Added selected-photo metadata row with filename, size and remove action.
- Switching back to text mode clears the local photo draft.
- Closing/resetting the sheet revokes the object URL and clears the file input.

## Not changed

- No new Prisma models.
- No backend changes.
- No real media upload wiring in this pass.
- `/api/stories/media/upload` is intentionally left for the next small pass.

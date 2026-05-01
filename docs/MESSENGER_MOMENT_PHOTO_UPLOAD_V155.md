# V155 — Messenger moment photo upload

Small KISS pass after V154.

## What changed

- Connected photo moments in `/chat` to the existing `POST /api/stories/media/upload` endpoint.
- Photo is uploaded before creating the story.
- The created story receives `media_url`, `preview_url`, and `duration_ms` from the upload response.
- Upload uses the existing CSRF flow and retries once on `401/403` with a refreshed token.
- The sheet now shows separate states: photo upload and moment publication.
- Local moment rail item keeps returned `mediaUrl` and `previewUrl` for the next viewer pass.
- `source=chat` is sent to the media upload endpoint metadata.

## Not changed

- No new Prisma models.
- No new storage layer.
- No new upload endpoint.
- No viewer yet.
- No fast reply yet.

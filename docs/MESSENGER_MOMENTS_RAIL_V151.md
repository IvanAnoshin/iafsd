# V151 — Messenger moments rail

Small KISS pass.

- Added a compact `Моменты` rail to the chat sidebar.
- The first ring is `Мой момент` and opens story creation with `source=chat`.
- Moment preview rings are generated from visible chats for now, without adding backend logic.
- Kept `/feed` clean: moments stay out of the feed after V150.
- Backend, Prisma and story APIs were not changed.

# Placeholder audit

Generated: 2026-04-26T18:45:15.217Z

| Area | Severity | Hits |
|---|---:|---:|
| Demo/seed data in runtime code | high | 0 |
| User-facing unavailable/fallback text | medium | 72 |
| Native browser alerts | medium | 0 |
| Local public uploads / non-production file storage | high | 41 |
| Process-memory realtime state | high | 0 |
| TODO/FIXME/HACK markers | low | 0 |

## Top findings

### Demo/seed data in runtime code

No hits.

### User-facing unavailable/fallback text

- `app/api/feed/posts/[postId]/comments/route.js:57` — return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
- `app/api/feed/posts/[postId]/comments/route.js:99` — return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
- `app/api/feed/posts/[postId]/route.js:42` — if (!canView) return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
- `app/api/feed/posts/[postId]/save/route.js:22` — return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
- `app/api/feed/posts/[postId]/share/route.js:98` — return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
- `app/api/feed/posts/[postId]/vote/route.js:30` — return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
- `app/api/posts/[id]/comments/route.js:57` — return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
- `app/api/posts/[id]/comments/route.js:99` — return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
- `app/api/posts/[id]/like/route.js:51` — return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
- `app/api/posts/[id]/like/route.js:140` — return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
- `app/api/posts/[id]/route.js:41` — return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
- `app/chat/components/ChatConversationWorkspace.jsx:273` — text: 'Пока собеседник не примет запрос, новые сообщения и медиа будут недоступны.',

### Native browser alerts

No hits.

### Local public uploads / non-production file storage

- `lib/chat-media.js:11` — const ROOT_UPLOADS_DIR = path.join(ROOT_PUBLIC_DIR, 'uploads', 'chat');
- `lib/chat-media.js:133` — basePath: '/uploads/chat',
- `lib/chat-media.js:228` — if (!rawUrl.startsWith('/uploads/chat/')) return null;
- `lib/chat-media.js:238` — const targetPath = path.join(ROOT_UPLOADS_DIR, ...segments);
- `lib/chat-media.js:239` — const normalizedRoot = path.normalize(ROOT_UPLOADS_DIR + path.sep);
- `lib/chat-media.js:418` — const targetDir = path.join(ROOT_UPLOADS_DIR, ...parts);
- `lib/chat-media.js:422` — publicUrl = path.posix.join('/uploads/chat', ...parts, filename);
- `lib/chat-media.js:425` — const preview = await writeLocalPreview({ rootDir: ROOT_UPLOADS_DIR, basePath: '/uploads/chat', parts, filename, previewBuffer });
- `lib/community-media.js:17` — const ROOT_UPLOADS_DIR = path.join(ROOT_PUBLIC_DIR, 'uploads', 'communities');
- `lib/community-media.js:81` — basePath: '/uploads/communities',
- `lib/community-media.js:197` — if (raw.startsWith('/uploads/communities/')) {
- `lib/community-media.js:199` — return raw.startsWith(`/uploads/communities/${communityId}/`);

### Process-memory realtime state

No hits.

### TODO/FIXME/HACK markers

No hits.

## Rule
Every hit must be either removed, replaced with real production behavior, or explicitly documented as an intentional empty/loading/error state.

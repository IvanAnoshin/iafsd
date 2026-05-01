import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { storeChatUpload } from '@/lib/chat-media';

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return NextResponse.json({ error: csrf.error }, { status: csrf.status });
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Выбери фото или видео для момент.' }, { status: 400 });
    }
    const kind = String(form.get('kind') || '').trim().toLowerCase();
    if (kind !== 'image' && kind !== 'video') {
      return NextResponse.json({ error: 'Поддерживаются только фото и видео.' }, { status: 400 });
    }

    const upload = await storeChatUpload({
      file,
      userId: session.user.id,
      kind,
      metadata: { source: 'stories' },
    });

    return NextResponse.json({
      ok: true,
      media: {
        kind,
        url: upload.url,
        mime: upload.mime,
        size: upload.bytes || 0,
        width: upload.width || null,
        height: upload.height || null,
        duration_ms: upload.durationSec ? upload.durationSec * 1000 : null,
        preview_url: upload.thumbUrl || upload.url,
      },
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('story media upload failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось загрузить медиа для момент.' }, { status: error?.status || 500 });
  }
}

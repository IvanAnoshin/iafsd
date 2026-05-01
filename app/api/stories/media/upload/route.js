import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { storeStoryUpload } from '@/lib/story-media';
import { enforceRateLimit } from '@/lib/anti-abuse';

export async function POST(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const uploadLimit = await enforceRateLimit({ request, policy: 'story_media_upload', actorUserId: session.user.id });
    if (uploadLimit) return uploadLimit;

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Выбери фото или видео для момент.' }, { status: 400 });
    }
    const kind = String(form.get('kind') || '').trim().toLowerCase();
    if (kind !== 'image' && kind !== 'video') {
      return NextResponse.json({ error: 'Поддерживаются только фото и видео.' }, { status: 400 });
    }
    const source = String(form.get('source') || 'stories').trim().toLowerCase().slice(0, 40) || 'stories';

    const upload = await storeStoryUpload({
      file,
      userId: session.user.id,
      kind,
      metadata: { source },
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
        storage: upload.storage || 'local',
        preview_bytes: upload.previewBytes || 0,
        preview_mime: upload.previewMime || null,
        preview_generated: Boolean(upload.previewGenerated),
        private: Boolean(upload.private),
        original_bytes: upload.originalBytes || upload.bytes,
        exif_stripped: Boolean(upload.exifStripped),
      },
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('story media upload failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось загрузить медиа для момент.' }, { status: error?.status || 500 });
  }
}

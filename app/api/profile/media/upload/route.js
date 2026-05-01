import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { storePostUpload } from '@/lib/post-media';
import { enforceRateLimit } from '@/lib/anti-abuse';

export const runtime = 'nodejs';

export async function POST(request) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const uploadLimit = await enforceRateLimit({ request, policy: 'profile_media_upload', actorUserId: session.user.id });
    if (uploadLimit) return uploadLimit;

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Выберите фото или видео.' }, { status: 400 });

    const kind = String(form.get('kind') || '').trim().toLowerCase();
    const upload = await storePostUpload({
      file,
      userId: session.user.id,
      kind,
      metadata: {
        width: form.get('width'),
        height: form.get('height'),
        durationSec: form.get('durationSec') || form.get('duration'),
      },
    });

    await writeAuditLog({
      request,
      session,
      action: 'profile.media.upload',
      entityType: 'user',
      entityId: session.user.id,
      metadata: { kind: upload.kind, bytes: upload.bytes, mime: upload.mime, storage: upload.storage || 'local' },
    }).catch(() => null);

    return NextResponse.json({
      ok: true,
      media: {
        kind: upload.kind,
        url: upload.url,
        thumbUrl: upload.thumbUrl,
        storage: upload.storage || 'local',
        previewBytes: upload.previewBytes || 0,
        previewMime: upload.previewMime || null,
        previewGenerated: Boolean(upload.previewGenerated),
        private: Boolean(upload.private),
        mime: upload.mime,
        bytes: upload.bytes,
        originalBytes: upload.originalBytes || upload.bytes,
        exifStripped: Boolean(upload.exifStripped),
        width: upload.width,
        height: upload.height,
        durationSec: upload.durationSec,
        originalName: upload.originalName,
      },
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('profile media upload failed', error);
    await writeAuditLog({ request, session, action: 'profile.media.upload', status: 'error', metadata: { error: error?.message || String(error) } }).catch(() => null);
    return NextResponse.json({ error: error?.message || 'Не удалось загрузить медиа профиля.' }, { status: error?.status || 500 });
  }
}

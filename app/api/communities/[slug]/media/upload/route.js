import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { storeCommunityUpload } from '@/lib/community-media';
import { canAdminCommunity, canPostInCommunity, getCommunityMembership, normalizeCommunitySlug } from '@/lib/communities';
import { enforceRateLimit } from '@/lib/anti-abuse';

export const runtime = 'nodejs';

function normalizePurpose(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'avatar' || raw === 'cover' || raw === 'post' || raw === 'gallery') return raw;
  return 'post';
}

export async function POST(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const uploadLimit = await enforceRateLimit({ request, policy: 'community_media_upload', actorUserId: session.user.id });
    if (uploadLimit) return uploadLimit;

    const { slug } = await params;
    const community = await prisma.community.findUnique({ where: { slug: normalizeCommunitySlug(slug) } });
    if (!community) return NextResponse.json({ error: 'Сообщество не найдено.' }, { status: 404 });

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Выберите файл для загрузки.' }, { status: 400 });

    const purpose = normalizePurpose(form.get('purpose'));
    const kind = String(form.get('kind') || '').trim().toLowerCase();
    const membership = await getCommunityMembership(community.id, session.user.id, prisma);

    if ((purpose === 'avatar' || purpose === 'cover') && !canAdminCommunity(membership)) {
      return NextResponse.json({ error: 'Аватар и обложку могут менять только владелец или администраторы.' }, { status: 403 });
    }
    if ((purpose === 'post' || purpose === 'gallery') && !canPostInCommunity(community, membership)) {
      return NextResponse.json({ error: 'Нет прав на загрузку медиа в это сообщество.' }, { status: 403 });
    }

    const upload = await storeCommunityUpload({
      file,
      userId: session.user.id,
      communityId: community.id,
      kind,
      purpose,
      metadata: {
        width: form.get('width'),
        height: form.get('height'),
        durationSec: form.get('durationSec') || form.get('duration'),
      },
    });

    const media = {
      kind: upload.kind,
      purpose: upload.purpose,
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
    };

    await writeAuditLog({
      request,
      session,
      action: 'community.media.upload',
      entityType: 'community',
      entityId: String(community.id),
      metadata: { slug: community.slug, purpose, kind: upload.kind, bytes: upload.bytes, mime: upload.mime },
    }).catch(() => null);

    return NextResponse.json({ media }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('community media upload failed', error);
    await writeAuditLog({ request, session, action: 'community.media.upload', status: 'error', metadata: { message: error?.message || 'unknown_error' } }).catch(() => null);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось загрузить медиа сообщества.' : error.message }, { status });
  }
}

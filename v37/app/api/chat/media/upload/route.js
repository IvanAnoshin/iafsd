import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { storeChatUpload } from '@/lib/chat-media';
import { recordMessengerMetric } from '@/lib/chat-observability';

export const runtime = 'nodejs';

export async function POST(request) {
  let session = null;
  const startedAt = Date.now();
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const formData = await request.formData();
    const file = formData.get('file');
    const kind = formData.get('type') || formData.get('kind') || '';
    const conversationId = String(formData.get('conversationId') || '').trim();

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Не найден файл для загрузки.' }, { status: 400 });
    }

    if (conversationId) {
      const membership = await prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId,
            userId: session.user.id,
          },
        },
        select: { conversationId: true },
      });
      if (!membership) {
        return NextResponse.json({ error: 'Нет доступа к этому диалогу.' }, { status: 403 });
      }
    }

    const upload = await storeChatUpload({
      file,
      userId: session.user.id,
      kind,
      metadata: {
        durationSec: formData.get('durationSec'),
        duration: formData.get('duration'),
        durationSeconds: formData.get('durationSeconds'),
        width: formData.get('width'),
        height: formData.get('height'),
        waveform: formData.get('waveform'),
      },
    });

    const media = {
      kind: upload.kind,
      url: upload.url,
      thumbUrl: upload.thumbUrl,
      mime: upload.mime,
      bytes: upload.bytes,
      durationSec: upload.durationSec,
      width: upload.width,
      height: upload.height,
      waveform: upload.waveform,
      originalName: upload.originalName,
    };

    await recordMessengerMetric({
      userId: session.user.id,
      conversationId: conversationId || null,
      category: 'media',
      metric: 'upload',
      outcome: 'success',
      value: upload.bytes,
      durationMs: Date.now() - startedAt,
      details: { kind: upload.kind, mime: upload.mime },
    });

    await writeAuditLog({
      request,
      session,
      action: 'chat.media.upload',
      entityType: 'conversation',
      entityId: conversationId || null,
      metadata: {
        kind: upload.kind,
        bytes: upload.bytes,
        mime: upload.mime,
        originalName: upload.originalName,
      },
    });

    return NextResponse.json({
      media,
      message_type: upload.kind,
      upload: {
        storage: 'local',
        original_name: upload.originalName,
      },
    }, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('chat media upload failed', error);
    await recordMessengerMetric({
      userId: session?.user?.id || null,
      category: 'media',
      metric: 'upload',
      outcome: 'error',
      durationMs: Date.now() - startedAt,
      details: { error: error?.message || String(error) },
    }).catch(() => null);
    await writeAuditLog({
      request,
      session,
      action: 'chat.media.upload',
      status: 'error',
      metadata: { error: error?.message || String(error) },
    });
    return NextResponse.json({ error: error?.message || 'Не удалось загрузить файл для чата.' }, { status: error?.status || 500 });
  }
}

import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { deleteChatUploads } from '@/lib/chat-media';

export const runtime = 'nodejs';

function extractUrls(body = {}) {
  const source = [];
  if (body?.url) source.push(body.url);
  if (Array.isArray(body?.urls)) source.push(...body.urls);
  if (Array.isArray(body?.media)) {
    body.media.forEach((item) => {
      if (item?.url) source.push(item.url);
    });
  }
  return [...new Set(source.map((item) => String(item || '').trim()).filter(Boolean))];
}

export async function DELETE(request) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const body = await request.json().catch(() => ({}));
    const urls = extractUrls(body);
    if (!urls.length) {
      return NextResponse.json({ error: 'Не переданы ссылки файлов для очистки.' }, { status: 400 });
    }

    const result = await deleteChatUploads({ urls, userId: session.user.id });

    await writeAuditLog({
      request,
      session,
      action: 'chat.media.cleanup',
      metadata: {
        requestedCount: urls.length,
        deletedCount: result.deletedCount,
      },
    });

    return NextResponse.json({
      deletedCount: result.deletedCount,
      results: result.results,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('chat media cleanup failed', error);
    await writeAuditLog({ request, session, action: 'chat.media.cleanup', status: 'error', metadata: { error: error?.message || String(error) } });
    return NextResponse.json({ error: error?.message || 'Не удалось очистить временные файлы чата.' }, { status: error?.status || 500 });
  }
}

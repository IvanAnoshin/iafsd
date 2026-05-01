import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { createPresignedGetUrl, getObjectStorageConfig } from '@/lib/object-storage';
import { getStorageProxyHeaders } from '@/lib/media-security';
import { canReadPostMediaObject } from '@/lib/access-control';

export const runtime = 'nodejs';

function normalizeKey(parts = []) {
  return (Array.isArray(parts) ? parts : [parts]).map((part) => String(part || '').trim()).filter(Boolean).join('/');
}

function isPostMediaKey(key = '') {
  const parts = String(key || '').split('/').filter(Boolean);
  return parts[0] === 'posts' && Number(parts[1] || 0) > 0;
}

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const resolvedParams = await params;
    const key = normalizeKey(resolvedParams?.key || []);
    if (!isPostMediaKey(key)) return NextResponse.json({ error: 'Некорректный ключ файла.' }, { status: 400 });

    const allowed = await canReadPostMediaObject(key, session.user.id);
    if (!allowed) return NextResponse.json({ error: 'Нет доступа к медиа поста.' }, { status: 403 });

    const config = getObjectStorageConfig('POST_MEDIA');
    if (!config.enabled) return NextResponse.json({ error: 'Объектное хранилище не настроено.' }, { status: 503 });

    const targetUrl = createPresignedGetUrl({ key, ttlSeconds: config.signedReadTtlSeconds, config });
    return NextResponse.redirect(targetUrl, { status: 302, headers: getStorageProxyHeaders() });
  } catch (error) {
    console.error('post storage proxy failed', error);
    return NextResponse.json({ error: 'Не удалось открыть медиа поста.' }, { status: error?.status || 500 });
  }
}

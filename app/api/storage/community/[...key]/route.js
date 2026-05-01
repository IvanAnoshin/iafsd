import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { canViewCommunityPosts, getCommunityMembership } from '@/lib/communities';
import { createPresignedGetUrl, getObjectStorageConfig } from '@/lib/object-storage';
import { getStorageProxyHeaders } from '@/lib/media-security';

export const runtime = 'nodejs';

function normalizeKey(parts = []) {
  return (Array.isArray(parts) ? parts : [parts])
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('/');
}

function communityIdFromKey(key) {
  const parts = String(key || '').split('/').filter(Boolean);
  if (parts[0] !== 'communities') return null;
  const id = Number(parts[1] || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const resolvedParams = await params;
    const key = normalizeKey(resolvedParams?.key || []);
    const communityId = communityIdFromKey(key);
    if (!communityId) return NextResponse.json({ error: 'Некорректный ключ файла.' }, { status: 400 });

    const community = await prisma.community.findUnique({ where: { id: communityId } });
    if (!community) return NextResponse.json({ error: 'Сообщество не найдено.' }, { status: 404 });

    const membership = await getCommunityMembership(community.id, session.user.id, prisma);
    if (!canViewCommunityPosts(community, membership)) {
      return NextResponse.json({ error: 'Нет доступа к медиа сообщества.' }, { status: 403 });
    }

    const config = getObjectStorageConfig('COMMUNITY_MEDIA');
    if (!config.enabled) return NextResponse.json({ error: 'Объектное хранилище не настроено.' }, { status: 503 });

    const targetUrl = createPresignedGetUrl({ key, ttlSeconds: config.signedReadTtlSeconds, config });
    return NextResponse.redirect(targetUrl, {
      status: 302,
      headers: getStorageProxyHeaders(),
    });
  } catch (error) {
    console.error('community storage proxy failed', error);
    return NextResponse.json({ error: 'Не удалось открыть медиа сообщества.' }, { status: error?.status || 500 });
  }
}

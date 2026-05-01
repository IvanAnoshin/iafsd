import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { createPresignedGetUrl, getObjectStorageConfig } from '@/lib/object-storage';
import { getStorageProxyHeaders } from '@/lib/media-security';

export const runtime = 'nodejs';

function normalizeKey(parts = []) {
  return (Array.isArray(parts) ? parts : [parts])
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('/');
}

function parseChatKey(key = '') {
  const parts = String(key || '').split('/').filter(Boolean);
  if (parts[0] !== 'chat') return null;
  if (parts[1] === 'conversation' && parts[2]) return { scope: 'conversation', conversationId: parts[2], uploaderId: Number(parts[3] || 0) || null };
  if (parts[1] === 'user' && parts[2]) return { scope: 'user', userId: Number(parts[2] || 0) || null };
  return null;
}

async function canReadChatObject(keyInfo, userId) {
  if (!keyInfo || !userId) return false;
  if (keyInfo.scope === 'user') return Number(keyInfo.userId) === Number(userId);
  if (keyInfo.scope === 'conversation') {
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: keyInfo.conversationId, userId: Number(userId) } },
      select: { conversationId: true },
    }).catch(() => null);
    return Boolean(member);
  }
  return false;
}

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const resolvedParams = await params;
    const key = normalizeKey(resolvedParams?.key || []);
    const keyInfo = parseChatKey(key);
    if (!keyInfo) return NextResponse.json({ error: 'Некорректный ключ файла.' }, { status: 400 });

    const allowed = await canReadChatObject(keyInfo, session.user.id);
    if (!allowed) return NextResponse.json({ error: 'Нет доступа к файлу чата.' }, { status: 403 });

    const config = getObjectStorageConfig('CHAT_MEDIA');
    if (!config.enabled) return NextResponse.json({ error: 'Объектное хранилище не настроено.' }, { status: 503 });

    const targetUrl = createPresignedGetUrl({ key, ttlSeconds: config.signedReadTtlSeconds, config });
    return NextResponse.redirect(targetUrl, { status: 302, headers: getStorageProxyHeaders() });
  } catch (error) {
    console.error('chat storage proxy failed', error);
    return NextResponse.json({ error: 'Не удалось открыть файл чата.' }, { status: error?.status || 500 });
  }
}

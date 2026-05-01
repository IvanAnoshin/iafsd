import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { collectUserMedia, ensureUserMediaSettings, serializeMediaSettings } from '@/lib/profile-media';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const [settingsRecord, posts] = await Promise.all([
      ensureUserMediaSettings(session.user.id),
      prisma.post.findMany({
        where: { authorId: session.user.id },
        orderBy: { createdAt: 'desc' },
        take: 80,
        include: { author: true },
      }),
    ]);

    const media = collectUserMedia(posts, session.user.id);

    return NextResponse.json({
      settings: serializeMediaSettings(settingsRecord),
      items: media.items,
      counts: media.counts,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('profile/media get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить медиа профиля.' }, { status: 500 });
  }
}

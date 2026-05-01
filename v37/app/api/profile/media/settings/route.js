import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { ensureUserMediaSettings, normalizeMediaFilter, normalizeMediaGrid, serializeMediaSettings } from '@/lib/profile-media';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const record = await ensureUserMediaSettings(session.user.id);
    return NextResponse.json({ settings: serializeMediaSettings(record) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('profile/media/settings get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить настройки альбома.' }, { status: 500 });
  }
}

export async function PUT(request) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const body = await request.json();
    const defaultFilter = normalizeMediaFilter(body.default_filter);
    const gridMode = normalizeMediaGrid(body.grid_mode);
    const showCards = typeof body.show_cards === 'boolean' ? body.show_cards : true;

    let record;
    if (!prisma.userMediaSettings) {
      record = { userId: session.user.id, defaultFilter, gridMode, showCards, __fallback: true };
    } else {
      try {
        record = await prisma.userMediaSettings.upsert({
          where: { userId: session.user.id },
          update: { defaultFilter, gridMode, showCards },
          create: { userId: session.user.id, defaultFilter, gridMode, showCards },
        });
      } catch (storageError) {
        console.warn('media settings persistence fallback enabled:', storageError?.code || storageError?.message || storageError);
        record = { userId: session.user.id, defaultFilter, gridMode, showCards, __fallback: true };
      }
    }

    await writeAuditLog({
      request,
      session,
      action: 'profile.media_settings.update',
      entityType: 'user',
      entityId: session.user.id,
      metadata: { defaultFilter, gridMode, showCards },
    });

    return NextResponse.json({
      message: record?.__fallback || !prisma.userMediaSettings ? 'Настройки альбома сохранены в режиме совместимости. Для постоянного сохранения обнови Prisma schema и базу.' : 'Настройки альбома сохранены.',
      settings: serializeMediaSettings(record),
    });
  } catch (error) {
    console.error('profile/media/settings put failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'profile.media_settings.update',
      entityType: 'user',
      entityId: session?.user?.id,
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: 'Не удалось сохранить настройки альбома.' }, { status: 500 });
  }
}

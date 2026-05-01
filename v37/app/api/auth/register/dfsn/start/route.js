import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST(request) {
  try {
    const body = await request.json();
    const registrationId = String(body.registration_id || '').trim();

    if (!registrationId) {
      return NextResponse.json({ error: 'Сессия регистрации не найдена.' }, { status: 400 });
    }

    const pending = await prisma.pendingRegistration.findUnique({
      where: { id: registrationId },
    });

    if (!pending) {
      return NextResponse.json({ error: 'Сессия регистрации устарела. Начните заново.' }, { status: 404 });
    }

    const session = await prisma.dfsnSession.create({
      data: {
        pendingRegistrationId: registrationId,
        phase: 'registration',
        route: String(body.route || '/register/dfsn'),
        screen: String(body.screen || 'register_dfsn'),
        timezone: body.timezone ? String(body.timezone) : null,
        locale: body.locale ? String(body.locale) : null,
        sessionHour: Number.isFinite(Number(body.session_hour)) ? Number(body.session_hour) : null,
        sessionWeekday: Number.isFinite(Number(body.session_weekday)) ? Number(body.session_weekday) : null,
        newDeviceFlag: Boolean(body.new_device_flag),
        newNetworkFlag: Boolean(body.new_network_flag),
        newGeoFlag: Boolean(body.new_geo_flag),
        typingEvents: [],
        mouseEvents: [],
        scrollEvents: [],
        startedAt: new Date(),
      },
    });

    await prisma.pendingRegistration.update({
      where: { id: registrationId },
      data: { dfsnSessionId: session.id },
    });

    return NextResponse.json({
      dfsn_session_id: session.id,
      duration_seconds: 30,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    console.error('register/dfsn/start failed', error);
    return NextResponse.json({ error: 'Не удалось начать DFSN-сессию.' }, { status: 500 });
  }
}

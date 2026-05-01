import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request) {
  let auditSession = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    auditSession = session;
    if (!session) {
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }

    await touchSession(session.id);

    const body = await request.json();
    const dfsnSession = await prisma.dfsnSession.create({
      data: {
        userId: session.userId,
        phase: 'setup',
        route: String(body.route || '/settings/dfsn'),
        screen: String(body.screen || 'settings_dfsn'),
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

    await writeAuditLog({
      request,
      session,
      action: 'dfsn.setup.start',
      entityType: 'dfsn_session',
      entityId: dfsnSession.id,
      metadata: {
        priorProfileExists: Boolean(session.user.behavioralProfile),
        previousTrustLabel: session.user.behavioralTrustLabel || null,
      },
    });

    return NextResponse.json({
      dfsn_session_id: dfsnSession.id,
      duration_seconds: 30,
      server_time: new Date().toISOString(),
      prior_profile_exists: Boolean(session.user.behavioralProfile),
      previous_trust_label: session.user.behavioralTrustLabel || null,
    });
  } catch (error) {
    console.error('auth/dfsn/setup/start failed', error);
    await writeAuditLog({
      request,
      session: auditSession,
      action: 'dfsn.setup.start',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: 'Не удалось начать DFSN-настройку.' }, { status: 500 });
  }
}

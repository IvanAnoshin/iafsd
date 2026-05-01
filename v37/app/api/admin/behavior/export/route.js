import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { csvEscape } from '@/lib/dfsn';
import { getCurrentSession, isAdminUser } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';

export async function GET(request) {
  let auditSession = null;
  try {
    auditSession = await getCurrentSession();
    if (!auditSession) {
      return NextResponse.json({ error: 'Требуется вход в аккаунт.' }, { status: 401 });
    }
    if (!isAdminUser(auditSession.user)) {
      await writeAuditLog({ request, session: auditSession, action: 'admin.behavior.export', status: 'forbidden' });
      return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const userId = searchParams.get('user_id');
    const trustLabel = searchParams.get('trust_label');
    const authOutcome = searchParams.get('auth_outcome');
    const route = searchParams.get('route');
    const phase = searchParams.get('phase');
    const limit = Math.min(Number(searchParams.get('limit') || 50000), 50000);

    const where = {};

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    if (userId) where.userId = Number(userId);
    if (trustLabel) where.trustLabel = trustLabel;
    if (authOutcome) where.authOutcome = authOutcome;
    if (route) where.route = route;
    if (phase) where.phase = phase;

    const sessions = await prisma.dfsnSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const header = [
      'session_id', 'user_id', 'pending_registration_id', 'phase', 'auth_outcome', 'trust_label',
      'label_source', 'is_passive', 'similarity_score', 'typing_speed', 'typing_variance',
      'correction_rate', 'mouse_speed', 'mouse_accuracy', 'hover_latency', 'scroll_depth',
      'scroll_speed', 'session_duration', 'session_hour', 'session_weekday', 'timezone',
      'locale', 'route', 'screen', 'new_device_flag', 'new_network_flag', 'new_geo_flag',
      'quality_flags', 'typing_event_total', 'mouse_event_total', 'scroll_event_total',
      'correction_total', 'top_key', 'screen_dwell_total', 'navigation_length',
      'navigation_signature', 'passive_collection', 'screen_width', 'screen_height',
      'hardware_concurrency', 'device_memory', 'platform', 'user_agent',
      'started_at', 'ended_at', 'created_at'
    ];

    const lines = [header.join(',')];

    for (const session of sessions) {
      const summaries = session.summaries && typeof session.summaries === 'object' ? session.summaries : {};
      const qualityFlags = Array.isArray(session.qualityFlags) ? session.qualityFlags.join('|') : '';
      const row = [
        session.id,
        session.userId ?? '',
        session.pendingRegistrationId ?? '',
        session.phase,
        session.authOutcome ?? '',
        session.trustLabel ?? '',
        session.labelSource ?? '',
        session.isPassive,
        session.similarityScore ?? '',
        session.typingSpeed ?? '',
        session.typingVariance ?? '',
        session.correctionRate ?? '',
        session.mouseSpeed ?? '',
        session.mouseAccuracy ?? '',
        session.hoverLatency ?? '',
        session.scrollDepth ?? '',
        session.scrollSpeed ?? '',
        session.sessionDuration ?? '',
        session.sessionHour ?? '',
        session.sessionWeekday ?? '',
        session.timezone ?? '',
        session.locale ?? '',
        session.route ?? '',
        session.screen ?? '',
        session.newDeviceFlag,
        session.newNetworkFlag,
        session.newGeoFlag,
        qualityFlags,
        summaries.typing_event_total ?? '',
        summaries.mouse_event_total ?? '',
        summaries.scroll_event_total ?? '',
        summaries.correction_total ?? '',
        summaries.top_key ?? '',
        summaries.screen_dwell_total ?? '',
        summaries.navigation_length ?? '',
        summaries.navigation_signature ?? '',
        summaries.passive_collection ?? '',
        summaries.screen_width ?? '',
        summaries.screen_height ?? '',
        summaries.hardware_concurrency ?? '',
        summaries.device_memory ?? '',
        summaries.platform ?? '',
        summaries.user_agent ?? '',
        session.startedAt?.toISOString?.() ?? '',
        session.endedAt?.toISOString?.() ?? '',
        session.createdAt?.toISOString?.() ?? '',
      ].map(csvEscape);

      lines.push(row.join(','));
    }

    await writeAuditLog({ request, session: auditSession, action: 'admin.behavior.export', entityType: 'dfsn_session', metadata: { exportedRows: sessions.length, from, to, userId, trustLabel, authOutcome, route, phase, limit } });

    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="dfsn-export.csv"',
        'X-DFSN-Export-Schema': 'dfsn-compact-v2',
      },
    });
  } catch (error) {
    console.error('admin/behavior/export failed', error);
    await writeAuditLog({ request, session: auditSession, action: 'admin.behavior.export', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось выгрузить DFSN-датасет.' }, { status: 500 });
  }
}

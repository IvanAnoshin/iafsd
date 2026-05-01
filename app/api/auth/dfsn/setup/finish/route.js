import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { computeDfsnFeatures, mergeBehavioralProfile } from '@/lib/dfsn';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

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
    const sessionId = String(body.dfsn_session_id || '').trim();

    if (!sessionId) {
      return NextResponse.json({ error: 'DFSN-сессия не найдена.' }, { status: 400 });
    }

    const dfsnSession = await prisma.dfsnSession.findUnique({
      where: { id: sessionId },
      include: {
        user: {
          select: {
            id: true,
            behavioralProfile: true,
            behavioralTrustLabel: true,
          },
        },
      },
    });

    if (!dfsnSession || dfsnSession.userId !== session.userId || dfsnSession.phase !== 'setup') {
      return NextResponse.json({ error: 'DFSN-сессия не найдена.' }, { status: 404 });
    }

    if (dfsnSession.endedAt) {
      return NextResponse.json({ error: 'DFSN-сессия уже завершена.' }, { status: 409 });
    }

    const endedAt = new Date();
    const features = computeDfsnFeatures({
      typingEvents: asArray(dfsnSession.typingEvents),
      mouseEvents: asArray(dfsnSession.mouseEvents),
      scrollEvents: asArray(dfsnSession.scrollEvents),
      startedAt: dfsnSession.startedAt,
      endedAt,
      route: dfsnSession.route || '/settings/dfsn',
      screen: dfsnSession.screen || 'settings_dfsn',
    });

    const nextProfile = mergeBehavioralProfile(dfsnSession.user?.behavioralProfile, features);
    const previousTrustLabel = dfsnSession.user?.behavioralTrustLabel || null;
    const priorProfileExists = Boolean(dfsnSession.user?.behavioralProfile);

    await prisma.$transaction(async (tx) => {
      await tx.dfsnSession.update({
        where: { id: sessionId },
        data: {
          endedAt,
          authOutcome: 'dfsn_setup_complete',
          trustLabel: 'trusted',
          labelSource: 'settings_setup',
          isPassive: false,
          typingSpeed: features.typingSpeed,
          typingVariance: features.typingVariance,
          correctionRate: features.correctionRate,
          mouseSpeed: features.mouseSpeed,
          mouseAccuracy: features.mouseAccuracy,
          hoverLatency: features.hoverLatency,
          scrollDepth: features.scrollDepth,
          scrollSpeed: features.scrollSpeed,
          sessionDuration: features.sessionDuration,
          activeHours: features.activeHours,
          pattern: features.pattern,
          qualityFlags: features.qualityFlags,
          summaries: {
            ...features.summaries,
            label_source: 'settings_setup',
            passive_collection: false,
            prior_profile_exists: priorProfileExists,
            previous_trust_label: previousTrustLabel,
          },
        },
      });

      await tx.user.update({
        where: { id: session.userId },
        data: {
          behavioralProfile: nextProfile,
          behavioralTrustLabel: 'trusted',
          behavioralUpdatedAt: endedAt,
        },
      });
    });

    await writeAuditLog({
      request,
      session,
      action: 'dfsn.setup.finish',
      entityType: 'dfsn_session',
      entityId: sessionId,
      metadata: {
        priorProfileExists,
        previousTrustLabel,
        qualityFlags: features.qualityFlags,
        sessionDuration: features.sessionDuration,
      },
    });

    return NextResponse.json({
      message: 'DFSN-профиль обновлён.',
      trust_label: 'trusted',
      prior_profile_exists: priorProfileExists,
      previous_trust_label: previousTrustLabel,
      quality_flags: features.qualityFlags,
      summary: {
        typing_speed: features.typingSpeed,
        typing_variance: features.typingVariance,
        correction_rate: features.correctionRate,
        mouse_speed: features.mouseSpeed,
        mouse_accuracy: features.mouseAccuracy,
        hover_latency: features.hoverLatency,
        scroll_depth: features.scrollDepth,
        scroll_speed: features.scrollSpeed,
        session_duration: features.sessionDuration,
      },
    });
  } catch (error) {
    console.error('auth/dfsn/setup/finish failed', error);
    await writeAuditLog({
      request,
      session: auditSession,
      action: 'dfsn.setup.finish',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: 'Не удалось завершить DFSN-настройку.' }, { status: 500 });
  }
}

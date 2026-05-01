import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { computeDfsnFeatures, mergeBehavioralProfile } from '@/lib/dfsn';

export async function POST(request) {
  try {
    const body = await request.json();
    const registrationId = String(body.registration_id || '').trim();
    const sessionId = String(body.dfsn_session_id || '').trim();

    if (!registrationId || !sessionId) {
      return NextResponse.json({ error: 'Сессия регистрации не найдена.' }, { status: 400 });
    }

    const session = await prisma.dfsnSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.pendingRegistrationId !== registrationId) {
      return NextResponse.json({ error: 'DFSN-сессия не найдена.' }, { status: 404 });
    }

    const endedAt = new Date();
    const features = computeDfsnFeatures({
      typingEvents: Array.isArray(session.typingEvents) ? session.typingEvents : [],
      mouseEvents: Array.isArray(session.mouseEvents) ? session.mouseEvents : [],
      scrollEvents: Array.isArray(session.scrollEvents) ? session.scrollEvents : [],
      startedAt: session.startedAt,
      endedAt,
    });

    const behavioralProfile = mergeBehavioralProfile(null, features);

    await prisma.$transaction(async (tx) => {
      await tx.dfsnSession.update({
        where: { id: sessionId },
        data: {
          endedAt,
          authOutcome: 'registration_complete',
          trustLabel: 'trusted',
          labelSource: 'registration_completion',
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
          summaries: { ...features.summaries, label_source: 'registration_completion', passive_collection: false },
        },
      });

      await tx.pendingRegistration.update({
        where: { id: registrationId },
        data: {
          dfsnCompleted: true,
          dfsnSessionId: sessionId,
          dfsnProfileSnapshot: behavioralProfile,
        },
      });
    });

    return NextResponse.json({
      message: 'DFSN session completed.',
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
    console.error('register/dfsn/finish failed', error);
    return NextResponse.json({ error: 'Не удалось завершить DFSN-сессию.' }, { status: 500 });
  }
}

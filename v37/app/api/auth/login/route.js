import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { createSessionForUser, applySessionCookie, ensureCsrfCookie } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import {
  computeDfsnFeatures,
  mergeBehavioralProfile,
  normalizeName,
  normalizedKey,
} from '@/lib/dfsn';

function asArray(value, limit = 500) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function asDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const firstName = normalizeName(body.first_name);
    const lastName = normalizeName(body.last_name);
    const password = String(body.password || '').trim();

    if (!firstName || !lastName || !password) {
      await writeAuditLog({ request, action: 'auth.login', status: 'failed', metadata: { reason: 'missing_credentials', firstName, lastName } });
      return NextResponse.json({ error: 'Введите имя, фамилию и пароль.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: {
        normalizedKey: normalizedKey(firstName, lastName),
      },
    });

    if (!user) {
      await writeAuditLog({ request, action: 'auth.login', status: 'failed', metadata: { reason: 'user_not_found', normalizedKey: normalizedKey(firstName, lastName) } });
      return NextResponse.json(
        { error: 'Аккаунт с такими именем и фамилией не найден.' },
        { status: 404 }
      );
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);

    if (!passwordOk) {
      await writeAuditLog({ request, actorUserId: user.id, action: 'auth.login', status: 'failed', metadata: { reason: 'bad_password' } });
      return NextResponse.json({ error: 'Неверный пароль.' }, { status: 401 });
    }

    const passiveDfsn = body.passive_dfsn && typeof body.passive_dfsn === 'object' ? body.passive_dfsn : null;

    if (passiveDfsn) {
      try {
        const typingEvents = asArray(passiveDfsn.typing_events, 700);
        const mouseEvents = asArray(passiveDfsn.mouse_events, 700);
        const scrollEvents = asArray(passiveDfsn.scroll_events, 300);
        const startedAt = asDate(passiveDfsn.started_at);
        const endedAt = asDate(passiveDfsn.ended_at);
        const route = String(passiveDfsn.route || '/');
        const screen = String(passiveDfsn.screen || 'login');

        const features = computeDfsnFeatures({
          typingEvents,
          mouseEvents,
          scrollEvents,
          startedAt,
          endedAt,
          route,
          screen,
        });

        const deviceContext = passiveDfsn.device_context && typeof passiveDfsn.device_context === 'object'
          ? passiveDfsn.device_context
          : {};

        const summaries = {
          ...features.summaries,
          label_source: 'password_login_success',
          passive_collection: true,
          screen_width: deviceContext.screen_width ?? null,
          screen_height: deviceContext.screen_height ?? null,
          hardware_concurrency: deviceContext.hardware_concurrency ?? null,
          device_memory: deviceContext.device_memory ?? null,
          platform: deviceContext.platform ?? null,
          user_agent: request.headers.get('user-agent') || null,
        };

        const nextProfile = mergeBehavioralProfile(user.behavioralProfile, features);

        await prisma.$transaction(async (tx) => {
          await tx.dfsnSession.create({
            data: {
              userId: user.id,
              phase: 'login',
              route,
              screen,
              authOutcome: 'login_success_password_only',
              trustLabel: 'trusted',
              labelSource: 'password_login_success',
              isPassive: true,
              timezone: passiveDfsn.timezone ? String(passiveDfsn.timezone) : null,
              locale: passiveDfsn.locale ? String(passiveDfsn.locale) : null,
              sessionHour: Number.isFinite(Number(passiveDfsn.session_hour)) ? Number(passiveDfsn.session_hour) : null,
              sessionWeekday: Number.isFinite(Number(passiveDfsn.session_weekday)) ? Number(passiveDfsn.session_weekday) : null,
              newDeviceFlag: Boolean(passiveDfsn.new_device_flag),
              newNetworkFlag: Boolean(passiveDfsn.new_network_flag),
              newGeoFlag: Boolean(passiveDfsn.new_geo_flag),
              typingEvents,
              mouseEvents,
              scrollEvents,
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
              summaries,
              startedAt,
              endedAt,
            },
          });

          await tx.user.update({
            where: { id: user.id },
            data: {
              behavioralProfile: nextProfile,
              behavioralTrustLabel: 'trusted',
              behavioralUpdatedAt: new Date(),
            },
          });
        });
      } catch (passiveError) {
        console.error('passive login dfsn save failed', passiveError);
      }
    }

    const { plainToken, session } = await createSessionForUser(user.id, request, {
      deviceContext: passiveDfsn?.device_context || {},
    });
    const response = NextResponse.json({
      message: 'Вход выполнен.',
      user: {
        id: user.id,
        first_name: user.firstName,
        last_name: user.lastName,
        created_at: user.createdAt,
      },
    });
    applySessionCookie(response, plainToken, session.expiresAt);
    ensureCsrfCookie(response, request);
    await writeAuditLog({ request, session, action: 'auth.login', entityType: 'session', entityId: session.id, metadata: { method: 'password', hasPassiveDfsn: Boolean(passiveDfsn) } });
    return response;
  } catch (error) {
    console.error('login failed', error);
    await writeAuditLog({ request, action: 'auth.login', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось выполнить вход.' }, { status: 500 });
  }
}

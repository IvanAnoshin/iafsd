import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { ensureUserPublicProfile, sanitizeProfileUpdate, serializeEditableProfile } from '@/lib/profile';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const user = await ensureUserPublicProfile(session.user.id);
    if (!user) {
      return NextResponse.json({ error: 'Профиль не найден.' }, { status: 404 });
    }

    return NextResponse.json({ profile: serializeEditableProfile(user) });
  } catch (error) {
    console.error('profile/get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить профиль.' }, { status: 500 });
  }
}

export async function PUT(request) {
  let auditSession = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    auditSession = session;
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);

    const body = await request.json();
    const nextData = sanitizeProfileUpdate(body);

    const updatedUser = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { id: session.user.id },
        include: { publicProfile: true },
      });

      if (!existingUser) return null;

      let publicProfile = existingUser.publicProfile;
      if (!publicProfile) {
        const ensured = await ensureUserPublicProfile(session.user.id, tx);
        if (!ensured) return null;
        publicProfile = ensured.publicProfile;
      }

      if (nextData.handle) {
        const handleOwner = await tx.userPublicProfile.findUnique({ where: { handle: nextData.handle } });
        if (handleOwner && handleOwner.userId !== session.user.id) {
          return { conflict: true };
        }
      }

      await tx.userPublicProfile.update({
        where: { userId: session.user.id },
        data: {
          ...(nextData.handle ? { handle: nextData.handle } : {}),
          bio: nextData.bio,
          occupation: nextData.occupation,
          city: nextData.city,
          relationshipStatus: nextData.relationshipStatus,
          personalDetails: nextData.personalDetails,
          ...(nextData.tone ? { tone: nextData.tone } : {}),
          ...(nextData.coverTone ? { coverTone: nextData.coverTone } : {}),
          avatarUrl: nextData.avatarUrl,
          coverUrl: nextData.coverUrl,
          interests: nextData.interests,
          ...(nextData.status ? { status: nextData.status } : {}),
        },
      });

      return tx.user.findUnique({
        where: { id: session.user.id },
        include: { publicProfile: true },
      });
    });

    if (!updatedUser) {
      return NextResponse.json({ error: 'Профиль не найден.' }, { status: 404 });
    }

    if (updatedUser.conflict) {
      await writeAuditLog({
        request,
        session,
        action: 'profile.update',
        status: 'failed',
        metadata: { reason: 'handle_taken', handle: nextData.handle || null },
      });
      return NextResponse.json({ error: 'Этот адрес профиля уже занят.' }, { status: 409 });
    }

    await writeAuditLog({
      request,
      session,
      action: 'profile.update',
      entityType: 'user_profile',
      entityId: String(session.user.id),
      metadata: {
        fields: Object.keys(nextData).filter((key) => nextData[key] !== undefined),
        tone: nextData.tone || null,
        coverTone: nextData.coverTone || null,
        hasAvatar: Boolean(nextData.avatarUrl),
        hasCover: Boolean(nextData.coverUrl),
        interestsCount: Array.isArray(nextData.interests) ? nextData.interests.length : 0,
        languagesCount: Array.isArray(nextData.personalDetails?.languages) ? nextData.personalDetails.languages.length : 0,
        status: nextData.status || null,
      },
    });

    return NextResponse.json({
      message: 'Профиль обновлён.',
      profile: serializeEditableProfile(updatedUser),
    });
  } catch (error) {
    console.error('profile/update failed', error);
    await writeAuditLog({
      request,
      session: auditSession,
      action: 'profile.update',
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    });
    return NextResponse.json({ error: 'Не удалось обновить профиль.' }, { status: 500 });
  }
}

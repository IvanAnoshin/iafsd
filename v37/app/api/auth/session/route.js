import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, ensureCsrfCookie, isAdminUser } from '@/lib/auth';

export async function GET(request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    await touchSession(session.id);

    const response = NextResponse.json({
      authenticated: true,
      user: {
        id: session.user.id,
        first_name: session.user.firstName,
        last_name: session.user.lastName,
        created_at: session.user.createdAt,
        is_admin: isAdminUser(session.user),
        dfsn: {
          configured: Boolean(session.user.behavioralProfile),
          trust_label: session.user.behavioralTrustLabel || null,
          updated_at: session.user.behavioralUpdatedAt || null,
        },
      },
      session: {
        id: session.id,
        label: session.label,
        created_at: session.createdAt,
        last_seen_at: session.lastSeenAt,
        expires_at: session.expiresAt,
      },
    });

    ensureCsrfCookie(response, request);
    return response;
  } catch (error) {
    console.error('auth/session failed', error);
    return NextResponse.json({ error: 'Не удалось получить текущую сессию.' }, { status: 500 });
  }
}

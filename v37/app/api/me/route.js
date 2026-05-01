import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { ensureUserPublicProfile, serializeEditableProfile } from '@/lib/profile';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await touchSession(session.id);
    const user = await ensureUserPublicProfile(session.user.id);
    if (!user) {
      return NextResponse.json({ error: 'Пользователь не найден.' }, { status: 404 });
    }

    return NextResponse.json({
      me: {
        ...serializeEditableProfile(user),
        dfsn: {
          configured: Boolean(user.behavioralProfile),
          trust_label: user.behavioralTrustLabel || null,
          updated_at: user.behavioralUpdatedAt || null,
        },
      },
    });
  } catch (error) {
    console.error('me/get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить данные пользователя.' }, { status: 500 });
  }
}

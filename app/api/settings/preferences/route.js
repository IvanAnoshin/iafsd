import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { getUserPreferences, updateUserPreferences } from '@/lib/user-preferences';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const preferences = await getUserPreferences(session.user.id);
    return NextResponse.json({ preferences }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('settings/preferences get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить настройки приватности.' }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const body = await request.json().catch(() => ({}));
    const preferences = await updateUserPreferences(session.user.id, body || {});
    return NextResponse.json({ message: 'Настройки сохранены.', preferences });
  } catch (error) {
    console.error('settings/preferences update failed', error);
    return NextResponse.json({ error: 'Не удалось сохранить настройки.' }, { status: 500 });
  }
}

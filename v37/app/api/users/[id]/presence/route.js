import { NextResponse } from 'next/server';
import { getPresenceForUser } from '@/lib/chat';
import { getCurrentSession, touchSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { getUserPreferences, getViewerRelation, isVisibilityAllowed } from '@/lib/user-preferences';

export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const resolved = await params;
    const targetId = Number(resolved.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return NextResponse.json({ error: 'Некорректный пользователь.' }, { status: 400 });
    }
    const preferences = await getUserPreferences(targetId, prisma);
    const relation = await getViewerRelation(session.user.id, targetId, prisma);
    if (!isVisibilityAllowed(preferences.activity_visibility, relation)) {
      return NextResponse.json({ presence: { userId: targetId, isOnline: false, lastSeenAt: null, source: null, conversationId: null, restricted: true } }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const presence = await getPresenceForUser(session.user.id, targetId);
    return NextResponse.json({ presence }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('presence get failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось получить статус присутствия.' }, { status: error?.status || 500 });
  }
}

import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { getRelationshipStatus } from '@/lib/social';

export async function GET(_request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });

    const targetUserId = Number((await params).id);
    const relationship = await getRelationshipStatus(session.user.id, targetUserId);
    return NextResponse.json(relationship);
  } catch (error) {
    console.error('users/relationship get failed', error);
    return NextResponse.json({ error: error?.message || 'Не удалось загрузить статус связи.' }, { status: error?.status || 500 });
  }
}

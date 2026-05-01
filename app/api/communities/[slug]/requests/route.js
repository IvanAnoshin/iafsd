import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';
import { communitySerializers, listJoinRequests } from '@/lib/communities';

export async function GET(request, { params }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    const { slug } = await params;
    const requests = await listJoinRequests(slug, session.user.id);
    return NextResponse.json({ requests: requests.map(communitySerializers.serializeJoinRequest) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('communities/requests list failed', error);
    const status = error?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось загрузить заявки.' : error.message }, { status });
  }
}

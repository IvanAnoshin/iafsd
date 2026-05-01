import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { getLaunchVerification } from '@/lib/launch-verification';

export async function GET(request) {
  let session = null;
  try {
    session = await requireAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Недостаточно прав.' }, { status: 403 });
    }

    const verification = await getLaunchVerification();
    await writeAuditLog({ request, session, action: 'admin.launch.verification', metadata: { status: verification.status, score: verification.score } });
    return NextResponse.json({ verification }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('admin/launch/verification failed', error);
    await writeAuditLog({ request, session, action: 'admin.launch.verification', status: 'error', metadata: { message: error?.message || 'unknown_error' } });
    return NextResponse.json({ error: 'Не удалось выполнить launch verification.' }, { status: 500 });
  }
}

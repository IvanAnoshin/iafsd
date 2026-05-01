import { adminJson, requireAdminRequest } from '@/lib/admin-security';
import { writeAuditLog } from '@/lib/audit';
import { getHealthStatus, withApiMonitoring } from '@/lib/monitoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  let userId = null;
  return withApiMonitoring(request, async () => {
    const guard = await requireAdminRequest(request, { action: 'admin.monitoring.overview' });
    if (guard.response) return guard.response;
    userId = guard.session?.user?.id || null;

    const health = await getHealthStatus({ includeCounts: true });
    await writeAuditLog({
      request,
      session: guard.session,
      action: 'admin.monitoring.overview',
      metadata: { status: health.status },
    }).catch(() => null);

    return adminJson({ monitoring: health }, { status: health.status === 'error' ? 503 : 200 });
  }, { route: '/api/admin/monitoring/overview', get userId() { return userId; } });
}

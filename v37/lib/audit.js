import prisma from '@/lib/prisma';

function getClientIp(request) {
  return request?.headers?.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request?.headers?.get('x-real-ip')
    || null;
}

function getUserAgent(request) {
  return request?.headers?.get('user-agent') || null;
}

function getRoutePath(request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return null;
  }
}

function makeJsonSafe(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { note: 'metadata_serialization_failed' };
  }
}

export async function writeAuditLog({
  request,
  session,
  actorUserId,
  action,
  entityType = null,
  entityId = null,
  status = 'success',
  metadata = null,
}) {
  if (!action) return;

  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: actorUserId ?? session?.user?.id ?? session?.userId ?? null,
        action,
        entityType,
        entityId: entityId == null ? null : String(entityId),
        status,
        route: request ? getRoutePath(request) : null,
        method: request?.method ? String(request.method).toUpperCase() : null,
        ipAddress: request ? getClientIp(request) : null,
        userAgent: request ? getUserAgent(request) : null,
        metadata: makeJsonSafe(metadata),
      },
    });
  } catch (error) {
    console.error('audit log write failed', {
      action,
      status,
      message: error?.message || String(error),
    });
  }
}

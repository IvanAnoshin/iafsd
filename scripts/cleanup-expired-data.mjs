import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const shouldDelete = args.has('--delete');

function readNumberArg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number(raw.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function maybeDelete(label, model, where) {
  const count = await prisma[model].count({ where }).catch((error) => ({ error }));
  if (count?.error) return { label, model, skipped: true, error: count.error.message };
  let deleted = 0;
  if (shouldDelete && count > 0) {
    const result = await prisma[model].deleteMany({ where });
    deleted = result.count || 0;
  }
  return { label, model, matched: count, deleted };
}

async function maybeUpdate(label, model, where, data) {
  const count = await prisma[model].count({ where }).catch((error) => ({ error }));
  if (count?.error) return { label, model, skipped: true, error: count.error.message };
  let updated = 0;
  if (shouldDelete && count > 0) {
    const result = await prisma[model].updateMany({ where, data });
    updated = result.count || 0;
  }
  return { label, model, matched: count, updated };
}

async function main() {
  const now = new Date();
  const notificationDays = readNumberArg('notifications-days', Number(process.env.NOTIFICATION_CLEANUP_READ_DAYS || 90));
  const abuseDays = readNumberArg('abuse-days', Number(process.env.ABUSE_EVENT_CLEANUP_DAYS || 90));
  const auditDays = readNumberArg('audit-days', Number(process.env.AUDIT_LOG_CLEANUP_DAYS || 365));
  const dfsnDays = readNumberArg('dfsn-days', Number(process.env.DFSN_SESSION_CLEANUP_DAYS || 180));
  const draftDays = readNumberArg('draft-days', Number(process.env.CHAT_DRAFT_CLEANUP_DAYS || 30));
  const realtimeDays = readNumberArg('realtime-days', Number(process.env.REALTIME_EVENT_RETENTION_DAYS || 3));

  const results = [];

  results.push(await maybeDelete('expired_sessions', 'session', { expiresAt: { lt: now } }));
  results.push(await maybeDelete('expired_passkey_challenges', 'passkeyChallenge', { expiresAt: { lt: now } }));
  results.push(await maybeDelete('expired_recovery_sessions', 'recoverySession', { expiresAt: { lt: now }, status: { not: 'completed' } }));
  results.push(await maybeDelete('expired_community_invites', 'communityInvite', { expiresAt: { not: null, lt: now } }));
  results.push(await maybeDelete('stale_read_notifications', 'notification', { isRead: true, createdAt: { lt: daysAgo(notificationDays) } }));
  results.push(await maybeDelete('old_abuse_events', 'abuseEvent', { createdAt: { lt: daysAgo(abuseDays) } }));
  results.push(await maybeDelete('old_audit_logs', 'auditLog', { createdAt: { lt: daysAgo(auditDays) } }));
  results.push(await maybeDelete('old_dfsn_sessions', 'dfsnSession', { createdAt: { lt: daysAgo(dfsnDays) } }));
  results.push(await maybeDelete('expired_typing_states', 'conversationTypingState', { expiresAt: { lt: now } }));
  results.push(await maybeDelete('expired_realtime_events', 'realtimeEvent', { expiresAt: { lt: now } }));
  results.push(await maybeUpdate('stale_chat_drafts', 'conversationMember', {
    draftText: { not: null },
    draftUpdatedAt: { not: null, lt: daysAgo(draftDays) },
  }, {
    draftText: null,
    draftUpdatedAt: null,
  }));

  console.log(JSON.stringify({
    ok: true,
    mode: shouldDelete ? 'delete' : 'dry-run',
    retention: {
      notification_days: notificationDays,
      abuse_days: abuseDays,
      audit_days: auditDays,
      dfsn_days: dfsnDays,
      draft_days: draftDays,
      realtime_days: realtimeDays,
    },
    results,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('[cleanup-expired-data] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });

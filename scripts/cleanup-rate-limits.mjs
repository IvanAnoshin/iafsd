import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const shouldDelete = process.argv.includes('--delete');

function readNumberArg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number(raw.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

const olderThanHours = readNumberArg('older-than-hours', Number(process.env.RATE_LIMIT_CLEANUP_OLDER_THAN_HOURS || 48));
const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
const where = {
  resetAt: { lt: cutoff },
  OR: [{ blockedUntil: null }, { blockedUntil: { lt: cutoff } }],
};

try {
  const matched = await prisma.rateLimitBucket.count({ where });
  let deleted = 0;
  if (shouldDelete && matched > 0) {
    const result = await prisma.rateLimitBucket.deleteMany({ where });
    deleted = result.count || 0;
  }
  console.log(JSON.stringify({
    ok: true,
    mode: shouldDelete ? 'delete' : 'dry-run',
    olderThanHours,
    matched,
    deleted,
  }, null, 2));
} catch (error) {
  console.error('[cleanup-rate-limits] failed:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => null);
}

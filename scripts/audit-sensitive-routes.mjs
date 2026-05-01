#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targets = [
  'app/api/admin',
  'app/api/auth/recover',
  'app/api/auth/recovery',
  'app/api/auth/passkeys',
  'app/api/devices',
  'app/api/account',
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && full.endsWith('/route.js')) out.push(full);
  }
  return out;
}

function hasWriteHandler(source) {
  return /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\s*\(/.test(source);
}

function hasGetHandler(source) {
  return /export\s+async\s+function\s+GET\s*\(/.test(source);
}

function classify(file) {
  const rel = path.relative(root, file).replaceAll(path.sep, '/');
  const source = fs.readFileSync(file, 'utf8');
  const issues = [];
  const isAdmin = rel.startsWith('app/api/admin/');
  const isRecovery = rel.includes('/auth/recover') || rel.includes('/auth/recovery');
  const isPasskey = rel.includes('/auth/passkeys');
  const isDevice = rel.includes('/api/devices/');
  const isAccount = rel.includes('/api/account/');

  if (isAdmin && !/requireAdminSession|requireAdminRequest|isAdminUser/.test(source)) issues.push('admin route without admin guard');
  if (isAdmin && hasWriteHandler(source) && !/verifyCsrf|requireAdminRequest\([^\n]+write:\s*true/s.test(source)) issues.push('admin write route without CSRF guard');
  if ((isRecovery || isPasskey) && hasWriteHandler(source) && !/enforceRateLimit/.test(source)) issues.push('auth-sensitive write route without rate limit');
  if ((isRecovery || isPasskey || isDevice || isAdmin) && hasGetHandler(source) && !/Cache-Control['"]:\s*['"]no-store|adminJson|adminCsv/.test(source)) issues.push('sensitive GET route without explicit no-store');
  if ((isPasskey || isDevice) && hasWriteHandler(source) && /DELETE|pin|disable/.test(source) && !/requirePasswordConfirmation|bcrypt\.compare/.test(source)) issues.push('sensitive device/passkey action without password confirmation');
  if (isRecovery && /status|questions/.test(rel) && !/cleanupExpiredRecoverySessionById/.test(source)) issues.push('recovery reader does not expire stale sessions');
  if (isRecovery && rel.endsWith('/complete/route.js') && !/verifyRecoveryCompletionToken/.test(source)) issues.push('recovery complete without completion token');

  return { file: rel, flags: issues };
}

const files = targets.flatMap((item) => walk(path.join(root, item))).sort();
const rows = files.map(classify);
const flagged = rows.filter((item) => item.flags.length);

const md = [
  '# Sensitive routes audit',
  '',
  `Scanned routes: ${rows.length}`,
  `Flagged routes: ${flagged.length}`,
  '',
  '## Flags',
  '',
  flagged.length ? flagged.map((item) => `- \`${item.file}\`: ${item.flags.join('; ')}`).join('\n') : 'No obvious sensitive-route guard gaps found by static scan.',
  '',
  '## Notes',
  '',
  '- This is a static guardrail, not a replacement for manual security review.',
  '- It focuses on admin, recovery, passkey, account-data and device-management routes.',
  '- Review false positives before changing production behavior.',
  '',
].join('\n');

fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'sensitive-routes-audit.md'), md);
fs.writeFileSync(path.join(root, 'docs', 'sensitive-routes-audit.json'), JSON.stringify({ scanned: rows.length, flagged: flagged.length, rows }, null, 2));
console.log(`Sensitive routes audit: ${flagged.length} flagged / ${rows.length} scanned`);

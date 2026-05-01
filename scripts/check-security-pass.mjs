import fs from 'fs';
import path from 'path';

const root = process.cwd();
const required = [
  'lib/media-security.js',
  'lib/url-safety.js',
  'lib/chat.js',
  'lib/posts.js',
  'lib/communities.js',
  'lib/stories.js',
  'app/api/feed/posts/route.js',
  'app/api/profile/posts/route.js',
  'next.config.js',
];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function walk(dir, out = []) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const next = path.join(abs, entry.name);
    if (entry.isDirectory()) walk(path.relative(root, next), out);
    else if (entry.isFile()) out.push(next);
  }
  return out;
}

const errors = [];
const warnings = [];
const checks = [];

function ok(name, detail) {
  checks.push({ name, status: 'ok', detail });
}
function warn(name, detail) {
  warnings.push(`${name}: ${detail}`);
  checks.push({ name, status: 'warn', detail });
}
function fail(name, detail) {
  errors.push(`${name}: ${detail}`);
  checks.push({ name, status: 'error', detail });
}

for (const file of required) exists(file) ? ok(`file:${file}`, 'present') : fail(`file:${file}`, 'missing');

const mediaSecurity = exists('lib/media-security.js') ? read('lib/media-security.js') : '';
/validateUploadSecurity/.test(mediaSecurity) ? ok('upload_sniffing', 'upload signature checks are present') : fail('upload_sniffing', 'validateUploadSecurity missing');
/assertMediaReferencesBelongToScope/.test(mediaSecurity) ? ok('media_reference_scope_guard', 'media references are checked against registry/scope') : fail('media_reference_scope_guard', 'media reference guard missing');
/sanitizeClientMediaUrl/.test(mediaSecurity) ? ok('server_media_url_sanitizer', 'server media URL sanitizer present') : fail('server_media_url_sanitizer', 'server media URL sanitizer missing');

const guardedFiles = {
  'app/api/feed/posts/route.js': 'assertMediaReferencesBelongToScope',
  'app/api/profile/posts/route.js': 'assertMediaReferencesBelongToScope',
  'lib/communities.js': 'assertMediaReferencesBelongToScope',
  'lib/chat.js': 'assertMediaReferencesBelongToScope',
  'lib/stories.js': 'assertMediaReferencesBelongToScope',
};
for (const [file, needle] of Object.entries(guardedFiles)) {
  exists(file) && read(file).includes(needle) ? ok(`media_guard:${file}`, 'present') : fail(`media_guard:${file}`, 'missing');
}

const clientUrlFiles = ['app/feed/page.jsx', 'app/communities/[slug]/page.jsx', 'app/chat/components/ChatConversationWorkspace.jsx'];
for (const file of clientUrlFiles) {
  exists(file) && read(file).includes('sanitizeUrlForClient') ? ok(`client_url_safety:${file}`, 'present') : fail(`client_url_safety:${file}`, 'missing');
}

const apiFiles = walk('app/api').filter((file) => file.endsWith('route.js'));
const badCsrf = [];
for (const abs of apiFiles) {
  const source = fs.readFileSync(abs, 'utf8');
  if (/csrf\.error|csrf\.status/.test(source)) badCsrf.push(path.relative(root, abs));
}
badCsrf.length ? fail('csrf_error_shape', badCsrf.join(', ')) : ok('csrf_error_shape', 'all CSRF failures return verifyCsrf response object');

const nextConfig = exists('next.config.js') ? read('next.config.js') : '';
/isProduction\s*\?/.test(nextConfig) && /unsafe-eval/.test(nextConfig) && /: "script-src 'self' 'unsafe-inline' 'unsafe-eval'"/.test(nextConfig)
  ? ok('csp_prod_no_unsafe_eval', 'unsafe-eval is limited to non-production branch')
  : fail('csp_prod_no_unsafe_eval', 'production/dev CSP split not detected');
/upgrade-insecure-requests/.test(nextConfig) ? ok('csp_upgrade_insecure_requests', 'production CSP upgrades insecure requests') : warn('csp_upgrade_insecure_requests', 'upgrade-insecure-requests not detected');

const dangerousInnerHtml = [];
for (const abs of walk('app').concat(walk('components'))) {
  if (!/\.(js|jsx|mjs)$/.test(abs)) continue;
  const rel = path.relative(root, abs);
  const source = fs.readFileSync(abs, 'utf8');
  if (/dangerouslySetInnerHTML/.test(source) && rel !== 'app/layout.jsx') dangerousInnerHtml.push(rel);
}
dangerousInnerHtml.length ? fail('dangerous_inner_html', dangerousInnerHtml.join(', ')) : ok('dangerous_inner_html', 'only allowlisted bootstrap script uses dangerouslySetInnerHTML');

const summary = {
  checked_at: new Date().toISOString(),
  status: errors.length ? 'error' : warnings.length ? 'warn' : 'ready',
  checks,
  warnings,
  errors,
};

fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/security-pass-report.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(root, 'docs/security-pass-report.md'), [
  '# Security pass report',
  '',
  `Generated: ${summary.checked_at}`,
  '',
  `Status: **${summary.status}**`,
  '',
  '| Status | Check | Detail |',
  '|---|---|---|',
  ...checks.map((item) => `| ${item.status} | ${item.name} | ${String(item.detail).replace(/\|/g, '\\|')} |`),
  '',
  ...(warnings.length ? ['## Warnings', '', ...warnings.map((item) => `- ${item}`), ''] : []),
  ...(errors.length ? ['## Errors', '', ...errors.map((item) => `- ${item}`), ''] : []),
].join('\n'));

console.log(JSON.stringify({ status: summary.status, checks: checks.length, warnings: warnings.length, errors: errors.length }, null, 2));
if (errors.length) process.exit(1);

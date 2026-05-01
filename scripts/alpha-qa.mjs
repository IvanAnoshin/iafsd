import fs from 'fs';
import path from 'path';

const root = process.cwd();
const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

function rel(...parts) {
  return path.join(root, ...parts);
}

function exists(file) {
  return fs.existsSync(rel(file));
}

function read(file) {
  return fs.readFileSync(rel(file), 'utf8');
}

function listFiles(dir, predicate) {
  const out = [];
  function walk(abs) {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (!predicate || predicate(next)) out.push(next);
    }
  }
  if (fs.existsSync(rel(dir))) walk(rel(dir));
  return out;
}

function hasWriteMethod(source) {
  return writeMethods.some((method) => new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(source));
}

function isCsrfExempt(route) {
  const normalized = route.replaceAll('\\', '/');
  return [
    '/app/api/auth/login/route.js',
    '/app/api/auth/register/',
    '/app/api/auth/recover/',
    '/app/api/auth/recovery/',
    '/app/api/auth/passkeys/authenticate/',
    '/app/api/auth/passkeys/register/options/route.js',
    '/app/api/auth/passkeys/register/verify/route.js',
  ].some((fragment) => normalized.includes(fragment));
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

const requiredPages = [
  'app/page.jsx',
  'app/register/page.jsx',
  'app/feed/page.jsx',
  'app/people/page.jsx',
  'app/profile/page.jsx',
  'app/profile/[id]/page.jsx',
  'app/chat/page.jsx',
  'app/settings/page.jsx',
  'app/feedback/page.jsx',
  'app/communities/page.jsx',
  'app/communities/[slug]/page.jsx',
  'app/stories/page.jsx',
  'app/terms/page.jsx',
  'app/privacy/page.jsx',
  'app/rules/page.jsx',
  'app/safety/page.jsx',
  'app/data/page.jsx',
  'app/delete-account/page.jsx',
];

const missingPages = requiredPages.filter((file) => !exists(file));
missingPages.length ? fail('required_pages', `missing: ${missingPages.join(', ')}`) : ok('required_pages', `${requiredPages.length} pages present`);

const requiredDocs = [
  'docs/ALPHA_RELEASE_NOTES.md',
  'docs/FINAL_ALPHA_QA_V87.md',
  'docs/PUBLIC_LEGAL_TRUST_PAGES_V88.md',
  'docs/ACCOUNT_DELETION_DATA_EXPORT_V89.md',
  'docs/MONITORING_LOGGING_ALERTING_V90.md',
  'docs/REALTIME_SCALING_V91.md',
  'docs/STORAGE_PRODUCTION_HARDENING_V92.md',
  'docs/PERFORMANCE_PASS_V93.md',
  'docs/ACCESSIBILITY_RESPONSIVE_FINAL_V94.md',
  'docs/SECURITY_PEN_TEST_STYLE_PASS_V95.md',
  'docs/STAGING_RELEASE_PIPELINE_V96.md',
  'docs/PUBLIC_BETA_QA_V97.md',
  'docs/PUBLIC_BETA_RELEASE_NOTES.md',
  'docs/RELEASE_RUNBOOK.md',
  'docs/ROLLBACK_RUNBOOK.md',
  'docs/MINIMUM_E2E_SMOKE_TESTS_V86.md',
  'docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md',
  'docs/BACKUP_RESTORE.md',
];
const missingDocs = requiredDocs.filter((file) => !exists(file));
missingDocs.length ? fail('required_docs', `missing: ${missingDocs.join(', ')}`) : ok('required_docs', `${requiredDocs.length} docs present`);

const packageJson = JSON.parse(read('package.json'));
const scripts = packageJson.scripts || {};
for (const scriptName of ['verify:launch', 'audit:placeholders', 'audit:access-control', 'audit:sensitive-routes', 'smoke:e2e', 'qa:alpha', 'account:deletions', 'monitor:alerts', 'realtime:check', 'storage:check', 'performance:check', 'accessibility:check', 'security:check', 'release:check', 'rollback:check', 'beta:qa']) {
  scripts[scriptName] ? ok(`script:${scriptName}`, 'present') : fail(`script:${scriptName}`, 'missing');
}

const proxySource = exists('proxy.js') ? read('proxy.js') : '';
for (const prefix of ['/profile', '/feed', '/chat', '/people', '/settings', '/feedback', '/communities', '/stories']) {
  proxySource.includes(prefix) ? ok(`proxy:${prefix}`, 'protected') : fail(`proxy:${prefix}`, 'not protected');
}
/Cache-Control/.test(proxySource) && /no-store/.test(proxySource)
  ? ok('proxy_no_store', 'protected pages add no-store headers')
  : fail('proxy_no_store', 'protected pages do not add no-store headers');

const nextConfig = exists('next.config.js') ? read('next.config.js') : '';
/\/api\/:path\*/.test(nextConfig) && /Cache-Control/.test(nextConfig) && /no-store/.test(nextConfig)
  ? ok('api_no_store', 'api responses have no-store header')
  : fail('api_no_store', 'api no-store header missing');
/communities\|stories/.test(nextConfig) || (nextConfig.includes('communities') && nextConfig.includes('stories'))
  ? ok('page_no_store', 'core pages have no-store header rule')
  : warn('page_no_store', 'core page no-store rule may not include communities/stories');

const routeFiles = listFiles('app/api', (file) => file.endsWith('route.js'));
const missingCsrf = [];
for (const abs of routeFiles) {
  const source = fs.readFileSync(abs, 'utf8');
  if (!hasWriteMethod(source)) continue;
  if (source.includes('verifyCsrf(') || source.includes('requireAdminWrite(')) continue;
  if (isCsrfExempt(abs)) continue;
  missingCsrf.push(path.relative(root, abs));
}
missingCsrf.length
  ? fail('csrf_write_routes', `missing CSRF guard: ${missingCsrf.slice(0, 20).join(', ')}${missingCsrf.length > 20 ? ` (+${missingCsrf.length - 20})` : ''}`)
  : ok('csrf_write_routes', 'all non-exempt write routes have CSRF guard');

const runtimeFiles = listFiles('app', (file) => /\.(js|jsx|mjs)$/.test(file)).concat(listFiles('lib', (file) => /\.(js|mjs)$/.test(file)));
const nativeDialogs = [];
for (const abs of runtimeFiles) {
  const source = fs.readFileSync(abs, 'utf8');
  const route = path.relative(root, abs);
  if (/\b(alert|confirm|prompt)\s*\(/.test(source)) nativeDialogs.push(route);
}
nativeDialogs.length ? fail('native_dialogs', nativeDialogs.join(', ')) : ok('native_dialogs', 'no alert/confirm/prompt calls in runtime');

const chatSource = exists('lib/chat.js') ? read('lib/chat.js') : '';
if (/CHAT_SEED_TEXTS/.test(chatSource) && !/FRIENDSCAPE_ENABLE_SEED_CHATS/.test(chatSource)) {
  fail('runtime_seeds', 'chat seed data exists without explicit env gate');
} else {
  ok('runtime_seeds', 'no ungated runtime seed data detected');
}

const summary = {
  checked_at: new Date().toISOString(),
  status: errors.length ? 'error' : warnings.length ? 'warn' : 'ready',
  checks,
  warnings,
  errors,
};

const docsDir = rel('docs');
fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(rel('docs/alpha-qa-report.json'), `${JSON.stringify(summary, null, 2)}\n`);

const lines = [
  '# Alpha QA report',
  '',
  `Generated: ${summary.checked_at}`,
  '',
  `Status: **${summary.status}**`,
  '',
  '## Checks',
  '',
  '| Status | Check | Detail |',
  '|---|---|---|',
  ...checks.map((item) => `| ${item.status} | ${item.name} | ${String(item.detail).replace(/\|/g, '\\|')} |`),
  '',
];

if (warnings.length) {
  lines.push('## Warnings', '', ...warnings.map((item) => `- ${item}`), '');
}
if (errors.length) {
  lines.push('## Errors', '', ...errors.map((item) => `- ${item}`), '');
}

fs.writeFileSync(rel('docs/alpha-qa-report.md'), `${lines.join('\n')}\n`);
console.log(JSON.stringify({ status: summary.status, checks: checks.length, warnings: warnings.length, errors: errors.length }, null, 2));
if (errors.length) process.exit(1);

process.exit(errors.length ? 1 : 0);

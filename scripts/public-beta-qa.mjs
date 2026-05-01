import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];
const checks = [];

function rel(file) {
  return path.join(root, file);
}

function exists(file) {
  return fs.existsSync(rel(file));
}

function read(file) {
  return fs.readFileSync(rel(file), 'utf8');
}

function ok(name, detail = 'ok') {
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

function requireFile(file, label = file) {
  exists(file) ? ok(label, 'present') : fail(label, 'missing');
}

function requireText(file, pattern, label) {
  if (!exists(file)) return fail(label, `${file} missing`);
  pattern.test(read(file)) ? ok(label, 'present') : fail(label, `${file} missing required text`);
}

function walk(dir, predicate, out = []) {
  const start = rel(dir);
  if (!fs.existsSync(start)) return out;
  for (const entry of fs.readdirSync(start, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git'].includes(entry.name)) continue;
    const next = path.join(start, entry.name);
    if (entry.isDirectory()) walk(path.relative(root, next), predicate, out);
    else if (!predicate || predicate(next)) out.push(next);
  }
  return out;
}

for (const file of [
  'app/feedback/page.jsx',
  'app/settings/page.jsx',
  'app/chat/page.jsx',
  'components/PostAuthBottomNav.jsx',
  'lib/support.js',
  'docs/PUBLIC_BETA_QA_V97.md',
  'docs/PUBLIC_BETA_RELEASE_NOTES.md',
]) requireFile(file);

const pkg = JSON.parse(read('package.json'));
for (const scriptName of [
  'beta:qa',
  'verify:launch',
  'qa:alpha',
  'smoke:e2e',
  'security:check',
  'release:check',
  'rollback:check',
]) {
  pkg.scripts?.[scriptName] ? ok(`script:${scriptName}`, pkg.scripts[scriptName]) : fail(`script:${scriptName}`, 'missing');
}

requireText('app/feedback/page.jsx', /api\/support\/tickets[\s\S]*x-csrf-token[\s\S]*role=\{status\.tone === 'error' \? 'alert' : 'status'\}/, 'feedback_page:csrf_and_status');
if (exists('components/PostAuthBottomNav.jsx') && /href="\/feedback"|Бета-отзыв|beta-feedback-pill/.test(read('components/PostAuthBottomNav.jsx'))) {
  fail('bottom_nav:feedback_entry_removed', 'feedback entry must live in settings, not bottom nav');
} else {
  ok('bottom_nav:feedback_entry_removed', 'no feedback entry in bottom nav');
}
requireText('app/settings/page.jsx', /openBetaFeedbackForm[\s\S]*beta_feedback[\s\S]*Оставить отзыв/, 'settings:feedback_entry');
requireText('app/settings/page.jsx', /beta_feedback[\s\S]*beta_bug[\s\S]*beta_onboarding/, 'settings:support_beta_categories');
if (exists('app/feed/page.jsx') && /feed-compose-card|publishPost|postDraft|postComposerOpen|posting/.test(read('app/feed/page.jsx'))) {
  fail('feed:read_only_aggregator', 'feed still contains posting composer/runtime');
} else {
  ok('feed:read_only_aggregator', 'posting composer removed from feed');
}
requireText('lib/support.js', /buildTicketMessage[\s\S]*Контекст:/, 'support:safe_context');
requireText('proxy.js', /feedback/, 'proxy:feedback_protected');
requireText('next.config.js', /feedback/, 'headers:feedback_no_store');
requireText('tests/smoke/pages.spec.js', /'\/feedback'/, 'smoke:feedback_page');
requireText('app/chat/page.jsx', /process\.env\.NODE_ENV !== 'production'[\s\S]*debug/, 'chat:debug_disabled_in_production');

if (exists('app/chat/page.jsx') && /fallback-anna|Анна Смирнова|запасной режим отображения/.test(read('app/chat/page.jsx'))) {
  fail('chat:no_fake_fallback_seed', 'fallback demo chat seed is still present');
} else {
  ok('chat:no_fake_fallback_seed', 'no demo fallback chat seed');
}

const runtimeFiles = [
  ...walk('app', (file) => /\.(js|jsx|mjs)$/.test(file)),
  ...walk('components', (file) => /\.(js|jsx|mjs)$/.test(file)),
];
const runtimeConsoleLog = [];
for (const abs of runtimeFiles) {
  const relative = path.relative(root, abs).replaceAll(path.sep, '/');
  const source = fs.readFileSync(abs, 'utf8');
  if (/console\.log\s*\(/.test(source)) runtimeConsoleLog.push(relative);
}
runtimeConsoleLog.length
  ? fail('runtime:no_console_log', runtimeConsoleLog.join(', '))
  : ok('runtime:no_console_log', 'no stray console.log in app/components runtime');

if (exists('.env.production.example')) {
  const prodEnv = read('.env.production.example');
  /localhost|friendscape_dev_password|friendscape_dev/.test(prodEnv)
    ? fail('production_env:no_localhost', '.env.production.example still contains localhost/dev defaults')
    : ok('production_env:no_localhost', 'no localhost/dev DB defaults');
  /APP_RELEASE_CHANNEL="?production"?/.test(prodEnv)
    ? ok('production_env:release_channel', 'production')
    : fail('production_env:release_channel', 'APP_RELEASE_CHANNEL production missing');
}

for (const doc of ['docs/RELEASE_RUNBOOK.md', 'docs/ROLLBACK_RUNBOOK.md', 'docs/ALPHA_RELEASE_NOTES.md']) {
  requireFile(doc);
}
requireText('docs/PUBLIC_BETA_RELEASE_NOTES.md', /known limitations|известные ограничения|feedback|обратная связь/i, 'beta_release_notes:limitations_and_feedback');
requireText('docs/PUBLIC_BETA_QA_V97.md', /first-run|онбординг|первый пост|первый чат|первое сообщество/i, 'beta_qa:critical_scenarios');

const summary = {
  checked_at: new Date().toISOString(),
  status: errors.length ? 'error' : warnings.length ? 'warn' : 'ready',
  checks,
  warnings,
  errors,
};

fs.mkdirSync(rel('docs'), { recursive: true });
fs.writeFileSync(rel('docs/public-beta-qa-report.json'), `${JSON.stringify(summary, null, 2)}\n`);
const lines = [
  '# Public beta QA report',
  '',
  `Generated: ${summary.checked_at}`,
  '',
  `Status: **${summary.status}**`,
  '',
  '| Status | Check | Detail |',
  '|---|---|---|',
  ...checks.map((item) => `| ${item.status} | ${item.name} | ${String(item.detail).replace(/\|/g, '\\|')} |`),
  '',
];
if (warnings.length) lines.push('## Warnings', '', ...warnings.map((item) => `- ${item}`), '');
if (errors.length) lines.push('## Errors', '', ...errors.map((item) => `- ${item}`), '');
fs.writeFileSync(rel('docs/public-beta-qa-report.md'), `${lines.join('\n')}\n`);

console.log(JSON.stringify({ status: summary.status, checks: checks.length, warnings: warnings.length, errors: errors.length }, null, 2));
if (errors.length) process.exit(1);

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
  pattern.test(read(file)) ? ok(label, 'present') : fail(label, `${file} does not include required text`);
}

function envValue(source, key) {
  const match = source.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

for (const file of [
  '.env.example',
  '.env.staging.example',
  '.env.production.example',
  'scripts/release-check.mjs',
  'scripts/rollback-check.mjs',
  'scripts/check-release-pipeline.mjs',
  'docs/RELEASE_RUNBOOK.md',
  'docs/ROLLBACK_RUNBOOK.md',
  'docs/STAGING_RELEASE_PIPELINE_V96.md',
  'deploy/staging/friendscape-next-staging.service',
  'deploy/staging/ecosystem.staging.config.cjs',
  'deploy/staging/nginx-staging.conf',
]) requireFile(file);

const pkg = JSON.parse(read('package.json'));
const scripts = pkg.scripts || {};
for (const scriptName of [
  'check:env',
  'check:staging',
  'release:check',
  'release:staging',
  'release:prod',
  'rollback:check',
  'backup:db',
  'deploy:migrate',
  'smoke:e2e',
  'monitor:alerts',
]) {
  scripts[scriptName] ? ok(`script:${scriptName}`, scripts[scriptName]) : fail(`script:${scriptName}`, 'missing');
}

if (exists('.env.staging.example')) {
  const source = read('.env.staging.example');
  envValue(source, 'APP_ENV') === 'staging' ? ok('staging_env:APP_ENV', 'staging') : fail('staging_env:APP_ENV', 'must be staging');
  envValue(source, 'APP_RELEASE_CHANNEL') === 'staging' ? ok('staging_env:APP_RELEASE_CHANNEL', 'staging') : fail('staging_env:APP_RELEASE_CHANNEL', 'must be staging');
  /staging\./.test(envValue(source, 'APP_PUBLIC_URL')) ? ok('staging_env:APP_PUBLIC_URL', envValue(source, 'APP_PUBLIC_URL')) : warn('staging_env:APP_PUBLIC_URL', 'does not look like a staging URL');
  /friendscape-staging/.test(source) ? ok('staging_env:separate_storage', 'uses staging bucket/prefix') : warn('staging_env:separate_storage', 'staging storage bucket/prefix not obvious');
}

if (exists('.env.production.example')) {
  const source = read('.env.production.example');
  envValue(source, 'APP_ENV') === 'production' ? ok('production_env:APP_ENV', 'production') : fail('production_env:APP_ENV', 'must be production');
  envValue(source, 'APP_RELEASE_CHANNEL') === 'production' ? ok('production_env:APP_RELEASE_CHANNEL', 'production') : fail('production_env:APP_RELEASE_CHANNEL', 'must be production');
}

requireText('docs/RELEASE_RUNBOOK.md', /backup[\s\S]*migrate[\s\S]*(restart|reload)[\s\S]*smoke/i, 'release_runbook:release_order');
requireText('docs/ROLLBACK_RUNBOOK.md', /(rollback|откат)[\s\S]*(backup|бэкап|dump)/i, 'rollback_runbook:backup_path');
requireText('docs/STAGING_RELEASE_PIPELINE_V96.md', /staging[\s\S]*production[\s\S]*rollback/i, 'v96_doc:pipeline_flow');
requireText('scripts/migrate-prod.mjs', /migrate["'`,\s]+deploy/, 'migrate_prod:uses_migrate_deploy');
requireText('scripts/prisma-push-dev.mjs', /NODE_ENV\s*===\s*'production'/, 'prisma_push:blocked_in_production');
requireText('app/api/version/route.js', /APP_RELEASE_CHANNEL|releaseChannel/, 'version_api:release_metadata');

const summary = {
  checked_at: new Date().toISOString(),
  status: errors.length ? 'error' : warnings.length ? 'warn' : 'ready',
  checks,
  warnings,
  errors,
};

fs.mkdirSync(rel('docs'), { recursive: true });
fs.writeFileSync(rel('docs/release-pipeline-report.json'), `${JSON.stringify(summary, null, 2)}\n`);
const lines = [
  '# Release pipeline report',
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
fs.writeFileSync(rel('docs/release-pipeline-report.md'), `${lines.join('\n')}\n`);

console.log(JSON.stringify({ status: summary.status, checks: checks.length, warnings: warnings.length, errors: errors.length }, null, 2));
if (errors.length) process.exit(1);

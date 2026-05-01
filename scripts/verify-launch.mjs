import fs from 'fs';
import path from 'path';

const root = process.cwd();
const requiredRoutes = [
  'app/api/health/route.js',
  'app/api/ready/route.js',
  'app/api/version/route.js',
  'app/api/auth/session/route.js',
  'app/api/feed/route.js',
  'app/api/people/route.js',
  'app/api/chats/route.js',
  'app/api/chats/[id]/e2ee/route.js',
  'app/api/notifications/route.js',
  'app/api/support/tickets/route.js',
  'app/api/settings/preferences/route.js',
  'app/api/account/export/route.js',
  'app/api/account/deletion/route.js',
  'app/api/e2ee/status/route.js',
  'app/api/e2ee/devices/route.js',
  'app/api/e2ee/backup/route.js',
  'app/api/e2ee/transfer/route.js',
  'app/api/admin/analytics/overview/route.js',
  'app/api/admin/launch/verification/route.js',
  'app/api/admin/monitoring/overview/route.js',
];
const requiredPages = ['app/feed/page.jsx', 'app/people/page.jsx', 'app/profile/page.jsx', 'app/chat/page.jsx', 'app/settings/page.jsx', 'app/communities/page.jsx', 'app/communities/[slug]/page.jsx', 'app/stories/page.jsx', 'app/feedback/page.jsx', 'app/terms/page.jsx', 'app/privacy/page.jsx', 'app/rules/page.jsx', 'app/safety/page.jsx', 'app/data/page.jsx', 'app/delete-account/page.jsx'];
const requiredDocs = [
  'docs/MESSENGER_PRELAUNCH_CHECKLIST.md',
  'docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md',
  'docs/ENVIRONMENT_VARIABLES.md',
  'docs/BACKUP_RESTORE.md',
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
];
const requiredDeployFiles = [
  '.env.example',
  '.env.production.example',
  '.env.staging.example',
  'deploy/README_DEPLOY.md',
  'deploy/nginx/friendscape-next.conf',
  'deploy/friendscape-next.service',
  'deploy/ecosystem.config.cjs',
  'deploy/staging/friendscape-next-staging.service',
  'deploy/staging/ecosystem.staging.config.cjs',
  'deploy/staging/nginx-staging.conf',
];
const requiredModels = [
  'User',
  'Session',
  'Post',
  'Comment',
  'Notification',
  'SupportTicket',
  'PostReport',
  'CommentReport',
  'TargetReport',
  'Conversation',
  'ChatMessage',
  'UserDevice',
  'UserPreference',
  'E2EEDevice',
  'E2EEBackup',
  'UserDataExport',
  'AccountDeletionRequest',
  'RealtimeEvent',
  'MediaObject',
];

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const routeErrors = requiredRoutes.filter((rel) => !exists(rel));
const pageErrors = requiredPages.filter((rel) => !exists(rel));
const docErrors = requiredDocs.filter((rel) => !exists(rel));
const deployFileErrors = requiredDeployFiles.filter((rel) => !exists(rel));
const schema = exists('prisma/schema.prisma') ? read('prisma/schema.prisma') : '';
const missingModels = requiredModels.filter((name) => !new RegExp(`model\\s+${name}\\s+\\{`).test(schema));
const topLevel = fs.readdirSync(root);
const middlewareFiles = topLevel.filter((name) => /^middleware\.(js|mjs|cjs|ts|tsx)$/.test(name));
const proxyFiles = topLevel.filter((name) => /^proxy\.(js|mjs|cjs|ts|tsx)$/.test(name));
const packageJson = JSON.parse(read('package.json'));
const scripts = packageJson.scripts || {};
const requiredScripts = [
  'dev',
  'build',
  'start',
  'prisma:generate',
  'prisma:push',
  'prisma:migrate:deploy',
  'deploy:migrate',
  'build:prod',
  'start:prod',
  'verify:launch',
  'account:deletions',
  'monitor:alerts',
  'realtime:check',
  'storage:check',
  'performance:check',
  'accessibility:check',
  'security:check',
  'check:staging',
  'release:check',
  'release:staging',
  'release:prod',
  'rollback:check',
  'beta:qa',
];
const missingScripts = requiredScripts.filter((name) => !scripts[name]);

const warnings = [];
if (!proxyFiles.length) warnings.push('proxy file missing');
if (middlewareFiles.length && proxyFiles.length) warnings.push(`proxy/middleware conflict: ${[...proxyFiles, ...middlewareFiles].join(', ')}`);

const nextConfigSource = exists('next.config.js') ? read('next.config.js') : '';
const hasPermissionsPolicy = /Permissions-Policy/.test(nextConfigSource) && /camera=\(self\)/.test(nextConfigSource) && /microphone=\(self\)/.test(nextConfigSource);
const hasNoStoreApiHeader = /source:\s*'\/api\/:path\*'/.test(nextConfigSource) && /Cache-Control/.test(nextConfigSource) && /no-store/.test(nextConfigSource);
const hasDeployMigrate = /migrate\s+deploy/.test(read('scripts/migrate-prod.mjs'));
const blocksDbPushInProd = /NODE_ENV\s*===\s*'production'/.test(read('scripts/prisma-push-dev.mjs'));

const errors = [];
if (routeErrors.length) errors.push(`missing routes: ${routeErrors.join(', ')}`);
if (pageErrors.length) errors.push(`missing pages: ${pageErrors.join(', ')}`);
if (docErrors.length) errors.push(`missing docs: ${docErrors.join(', ')}`);
if (deployFileErrors.length) errors.push(`missing deploy files: ${deployFileErrors.join(', ')}`);
if (missingModels.length) errors.push(`missing prisma models: ${missingModels.join(', ')}`);
if (missingScripts.length) errors.push(`missing package scripts: ${missingScripts.join(', ')}`);
if (!hasPermissionsPolicy) errors.push('next.config.js missing strict Permissions-Policy for camera/microphone self');
if (!hasDeployMigrate) errors.push('deploy:migrate does not appear to use prisma migrate deploy');
if (!blocksDbPushInProd) errors.push('prisma db push is not blocked in production');
if (!hasNoStoreApiHeader) warnings.push('api no-store cache header not detected in next.config.js');

const summary = {
  checked_at: new Date().toISOString(),
  status: errors.length ? 'error' : warnings.length ? 'warn' : 'ready',
  routes_checked: requiredRoutes.length,
  pages_checked: requiredPages.length,
  docs_checked: requiredDocs.length,
  deploy_files_checked: requiredDeployFiles.length,
  models_checked: requiredModels.length,
  permissions_policy_locked: hasPermissionsPolicy,
  api_no_store_header: hasNoStoreApiHeader,
  deploy_migrate_uses_prisma_migrate_deploy: hasDeployMigrate,
  prisma_push_blocked_in_production: blocksDbPushInProd,
  warnings,
  errors,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exit(1);

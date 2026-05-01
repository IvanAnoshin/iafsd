import fs from 'fs';
import path from 'path';

const root = process.cwd();
const requiredRoutes = [
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
  'app/api/e2ee/status/route.js',
  'app/api/e2ee/devices/route.js',
  'app/api/e2ee/backup/route.js',
  'app/api/e2ee/transfer/route.js',
  'app/api/admin/analytics/overview/route.js',
  'app/api/admin/launch/verification/route.js',
];
const requiredPages = ['app/feed/page.jsx', 'app/people/page.jsx', 'app/profile/page.jsx', 'app/chat/page.jsx', 'app/settings/page.jsx'];
const requiredModels = ['User', 'Session', 'Post', 'Comment', 'Notification', 'SupportTicket', 'PostReport', 'Conversation', 'ChatMessage', 'UserDevice', 'UserPreference', 'E2EEDevice', 'E2EEBackup'];

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const routeErrors = requiredRoutes.filter((rel) => !exists(rel));
const pageErrors = requiredPages.filter((rel) => !exists(rel));
const schema = exists('prisma/schema.prisma') ? read('prisma/schema.prisma') : '';
const missingModels = requiredModels.filter((name) => !new RegExp(`model\\s+${name}\\s+\\{`).test(schema));
const topLevel = fs.readdirSync(root);
const middlewareFiles = topLevel.filter((name) => /^middleware\.(js|mjs|cjs|ts|tsx)$/.test(name));
const proxyFiles = topLevel.filter((name) => /^proxy\.(js|mjs|cjs|ts|tsx)$/.test(name));
const packageJson = JSON.parse(read('package.json'));
const scripts = packageJson.scripts || {};
const requiredScripts = ['dev', 'build', 'start', 'prisma:generate', 'prisma:push', 'verify:launch'];
const missingScripts = requiredScripts.filter((name) => !scripts[name]);

const warnings = [];
if (!proxyFiles.length) warnings.push('proxy file missing');
if (middlewareFiles.length && proxyFiles.length) warnings.push(`proxy/middleware conflict: ${[...proxyFiles, ...middlewareFiles].join(', ')}`);
if (!exists('.env.example')) warnings.push('.env.example missing');
if (!exists('docs/MESSENGER_PRELAUNCH_CHECKLIST.md')) warnings.push('messenger prelaunch checklist missing');

const nextConfigSource = exists('next.config.js') ? read('next.config.js') : '';
const hasPermissionsPolicy = /Permissions-Policy/.test(nextConfigSource) && /camera=\(self\)/.test(nextConfigSource) && /microphone=\(self\)/.test(nextConfigSource);
const hasNoStoreApiHeader = /source:\s*'\/api\/:path\*'/.test(nextConfigSource) && /Cache-Control/.test(nextConfigSource) && /no-store/.test(nextConfigSource);
const hasLaunchChecklist = exists('docs/MESSENGER_PRELAUNCH_CHECKLIST.md');

const errors = [];
if (routeErrors.length) errors.push(`missing routes: ${routeErrors.join(', ')}`);
if (pageErrors.length) errors.push(`missing pages: ${pageErrors.join(', ')}`);
if (missingModels.length) errors.push(`missing prisma models: ${missingModels.join(', ')}`);
if (missingScripts.length) errors.push(`missing package scripts: ${missingScripts.join(', ')}`);
if (!hasPermissionsPolicy) errors.push('next.config.js missing strict Permissions-Policy for camera/microphone self');
if (!hasNoStoreApiHeader) warnings.push('api no-store cache header not detected in next.config.js');
if (!hasLaunchChecklist) warnings.push('messenger launch checklist doc not detected');

const summary = {
  checked_at: new Date().toISOString(),
  status: errors.length ? 'error' : warnings.length ? 'warn' : 'ready',
  routes_checked: requiredRoutes.length,
  pages_checked: requiredPages.length,
  models_checked: requiredModels.length,
  permissions_policy_locked: hasPermissionsPolicy,
  api_no_store_header: hasNoStoreApiHeader,
  messenger_checklist_present: hasLaunchChecklist,
  warnings,
  errors,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exit(1);

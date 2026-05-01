import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

const errors = [];
const warnings = [];

const requiredFiles = [
  'lib/realtime-transport.js',
  'lib/chat-realtime.js',
  'app/api/realtime/stream/route.js',
  'prisma/migrations/20260426_realtime_scaling_pg/migration.sql',
];
for (const file of requiredFiles) {
  if (!exists(file)) errors.push(`missing ${file}`);
}

const transport = exists('lib/realtime-transport.js') ? read('lib/realtime-transport.js') : '';
const chatRealtime = exists('lib/chat-realtime.js') ? read('lib/chat-realtime.js') : '';
const streamRoute = exists('app/api/realtime/stream/route.js') ? read('app/api/realtime/stream/route.js') : '';
const schema = exists('prisma/schema.prisma') ? read('prisma/schema.prisma') : '';
const envProd = exists('.env.production.example') ? read('.env.production.example') : '';

if (!/model\s+RealtimeEvent\s+\{/.test(schema)) errors.push('RealtimeEvent model missing');
if (!/pg_notify/.test(transport)) errors.push('Postgres pg_notify publisher missing');
if (!/LISTEN/.test(transport)) errors.push('Postgres LISTEN subscriber missing');
if (!/subscribeRealtimeUser/.test(chatRealtime) || !/publishRealtimeUsers/.test(chatRealtime)) errors.push('chat realtime wrapper is not using transport adapter');
if (!/await\s+subscribeUserStream/.test(streamRoute)) errors.push('SSE route must await async realtime subscription');
if (!/REALTIME_TRANSPORT=postgres/.test(envProd)) warnings.push('production env template should use REALTIME_TRANSPORT=postgres');
if (/globalThis\.__friendscapeChatRealtime|global\.__friendscapeChatRealtime/.test(chatRealtime + transport)) errors.push('old process-global realtime state still present');

const summary = {
  checked_at: new Date().toISOString(),
  status: errors.length ? 'error' : warnings.length ? 'warn' : 'ready',
  files_checked: requiredFiles.length,
  warnings,
  errors,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exit(1);

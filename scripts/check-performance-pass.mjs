import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'lib/performance.js',
  'prisma/migrations/20260426_performance_pass/migration.sql',
  'docs/PERFORMANCE_PASS_V93.md',
];

const requiredSnippets = [
  ['prisma/schema.prisma', '@@index([authorId, status, communityId, createdAt])'],
  ['prisma/schema.prisma', '@@index([status, visibility, createdAt])'],
  ['prisma/schema.prisma', '@@index([type, status, createdAt])'],
  ['prisma/schema.prisma', '@@index([communityId, type, status, createdAt])'],
  ['prisma/schema.prisma', '@@index([postId, deletedAt, createdAt])'],
  ['prisma/schema.prisma', '@@index([userId, status, communityId])'],
  ['lib/posts.js', 'post?._count?.comments'],
  ['app/api/feed/route.js', 'buildPostListInclude(session.user.id)'],
  ['app/api/feed/route.js', 'next_cursor'],
  ['app/api/profile/posts/route.js', 'limit + 1'],
  ['app/api/users/[id]/posts/route.js', 'limit + 1'],
  ['app/api/profile/media/route.js', 'select:'],
  ['app/api/users/[id]/media/route.js', 'select:'],
  ['lib/communities.js', 'PERF_LIMITS.communityPosts'],
  ['lib/communities.js', 'PERF_LIMITS.mediaItems'],
];

let failed = false;
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`performance: missing ${file}`);
    failed = true;
  }
}

for (const [file, snippet] of requiredSnippets) {
  const fullPath = path.join(root, file);
  const body = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
  if (!body.includes(snippet)) {
    console.error(`performance: ${file} does not include ${snippet}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('performance:check ready');

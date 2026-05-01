import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const root = process.cwd();
const uploadsRoot = path.join(root, 'public', 'uploads', 'communities');
const prisma = new PrismaClient();
const shouldDelete = process.argv.includes('--delete');

function collectUrlsFromPayload(payload, urls) {
  if (!payload || typeof payload !== 'object') return;
  const media = Array.isArray(payload.media) ? payload.media : [];
  for (const item of media) {
    if (item?.url) urls.add(String(item.url));
    if (item?.thumbUrl) urls.add(String(item.thumbUrl));
    if (item?.thumb_url) urls.add(String(item.thumb_url));
  }
}

function urlToLocalPath(url) {
  const raw = String(url || '').trim();
  if (!raw.startsWith('/uploads/communities/')) return null;
  const relative = raw.replace(/^\/uploads\/communities\//, '');
  const target = path.join(uploadsRoot, ...relative.split('/').filter(Boolean));
  const normalizedRoot = path.normalize(uploadsRoot + path.sep);
  const normalizedTarget = path.normalize(target);
  return normalizedTarget.startsWith(normalizedRoot) ? normalizedTarget : null;
}

async function walkFiles(dir) {
  const files = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function main() {
  const referencedUrls = new Set();
  const referencedPaths = new Set();

  const communities = await prisma.community.findMany({ select: { avatarUrl: true, coverUrl: true } });
  for (const community of communities) {
    if (community.avatarUrl) referencedUrls.add(community.avatarUrl);
    if (community.coverUrl) referencedUrls.add(community.coverUrl);
  }

  const posts = await prisma.post.findMany({
    where: { communityId: { not: null } },
    select: { payload: true },
  });
  for (const post of posts) collectUrlsFromPayload(post.payload, referencedUrls);

  for (const url of referencedUrls) {
    const localPath = urlToLocalPath(url);
    if (localPath) referencedPaths.add(localPath);
  }

  const localFiles = await walkFiles(uploadsRoot);
  const unused = localFiles.filter((file) => !referencedPaths.has(path.normalize(file)));
  let deleted = 0;

  if (shouldDelete) {
    for (const file of unused) {
      await fs.unlink(file).then(() => { deleted += 1; }).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
  }

  const summary = {
    mode: shouldDelete ? 'delete' : 'dry-run',
    referenced_urls: referencedUrls.size,
    referenced_local_files: referencedPaths.size,
    scanned_local_files: localFiles.length,
    unused_local_files: unused.length,
    deleted_local_files: deleted,
    unused: unused.map((file) => path.relative(root, file)).slice(0, 200),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error('[cleanup-community-media] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });

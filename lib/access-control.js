import prisma from '@/lib/prisma';
import { canViewerAccessPost } from '@/lib/posts';
import { listStoriesFoundation } from '@/lib/stories';

export function toPositiveId(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

export function accessDenied(message = 'Нет доступа.', status = 403) {
  return Object.assign(new Error(message), { status });
}

export async function loadPostForViewer(postId, viewerUserId, db = prisma, include = {}) {
  const targetPostId = toPositiveId(postId);
  if (!targetPostId) throw accessDenied('Некорректный пост.', 400);

  const post = await db.post.findUnique({
    where: { id: targetPostId },
    include: {
      community: true,
      ...include,
    },
  });

  if (!post) throw accessDenied('Пост не найден.', 404);
  if (!(await canViewerAccessPost(post, viewerUserId, db))) {
    throw accessDenied('Пост недоступен.', 403);
  }

  return post;
}

export async function loadCommentForViewer(commentId, viewerUserId, db = prisma, include = {}) {
  const targetCommentId = toPositiveId(commentId);
  if (!targetCommentId) throw accessDenied('Некорректный комментарий.', 400);

  const comment = await db.comment.findUnique({
    where: { id: targetCommentId },
    include: {
      post: {
        include: {
          community: true,
        },
      },
      ...include,
    },
  });

  if (!comment) throw accessDenied('Комментарий не найден.', 404);
  if (!(await canViewerAccessPost(comment.post, viewerUserId, db))) {
    throw accessDenied('Комментарий недоступен.', 403);
  }

  return comment;
}

function keyContainsMediaReference(value, key) {
  if (!value || !key) return false;
  if (typeof value === 'string') return value.includes(key);
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  if (Array.isArray(value)) return value.some((item) => keyContainsMediaReference(item, key));
  if (typeof value === 'object') return Object.values(value).some((item) => keyContainsMediaReference(item, key));
  return false;
}

function parseOwnerIdFromObjectKey(key = '', expectedPrefix = '') {
  const parts = String(key || '').split('/').filter(Boolean);
  if (parts[0] !== expectedPrefix) return null;
  return toPositiveId(parts[1]);
}

async function findReadableReferencedPost({ key, ownerId, viewerUserId, db = prisma, scanLimit = 160 }) {
  const where = {
    deletedAt: null,
  };
  if (ownerId) where.authorId = ownerId;

  const posts = await db.post.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: scanLimit,
    include: { community: true },
  }).catch(() => []);

  for (const post of posts) {
    if (!keyContainsMediaReference(post.payload, key)) continue;
    if (await canViewerAccessPost(post, viewerUserId, db)) return post;
  }

  return null;
}

export async function canReadPostMediaObject(key, viewerUserId, db = prisma) {
  const viewerId = toPositiveId(viewerUserId);
  const ownerId = parseOwnerIdFromObjectKey(key, 'posts');
  if (!viewerId || !ownerId) return false;

  // A user may always read their own freshly uploaded object, even before the post is saved.
  if (ownerId === viewerId) return true;

  const scanLimit = Math.min(Math.max(Number(process.env.POST_MEDIA_ACCESS_SCAN_LIMIT || 160) || 160, 20), 500);
  return Boolean(await findReadableReferencedPost({ key, ownerId, viewerUserId: viewerId, db, scanLimit }));
}

export async function canReadStoryMediaObject(key, viewerUserId, db = prisma) {
  const viewerId = toPositiveId(viewerUserId);
  const ownerId = parseOwnerIdFromObjectKey(key, 'stories');
  if (!viewerId || !ownerId) return false;

  // A user may always read their own story upload, including upload previews before publish.
  if (ownerId === viewerId) return true;

  const result = await listStoriesFoundation(viewerId, { userId: ownerId, includeExpired: false, limit: 30 }, db).catch(() => null);
  const stories = Array.isArray(result?.items) ? result.items : [];
  return stories.some((story) => keyContainsMediaReference(story, key));
}

export async function filterPostsForViewer(posts, viewerUserId, db = prisma) {
  const list = Array.isArray(posts) ? posts : [];
  const allowed = [];
  for (const post of list) {
    if (await canViewerAccessPost(post, viewerUserId, db)) allowed.push(post);
  }
  return allowed;
}

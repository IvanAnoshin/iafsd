import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { enforceRateLimit } from '@/lib/anti-abuse';
import { ensureUserNotRestricted } from '@/lib/moderation-enforcement';
import { buildPersonalPostPayload, canViewerAccessPost, normalizePostText, normalizePostVisibility, serializePostForViewer } from '@/lib/posts';
import { buildPostListInclude } from '@/lib/performance';
import { canPostInCommunity } from '@/lib/communities';

const MAX_REPOST_COMMENT = 420;

function safePayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRepostComment(value) {
  return normalizePostText(value, MAX_REPOST_COMMENT) || '';
}

function normalizeTargetType(value) {
  const normalized = String(value || 'profile').trim().toLowerCase();
  return normalized === 'community' ? 'community' : 'profile';
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function canRepostOriginal(post, viewerId = null) {
  if (!post || post.deletedAt || String(post.status || 'visible') !== 'visible') return false;
  const visibility = normalizePostVisibility(post.visibility, 'public');
  const isAuthor = Number(viewerId || 0) > 0 && Number(post.authorId || post.author?.id || 0) === Number(viewerId);
  if (post.communityId) {
    return visibility === 'public' && post.community?.visibility === 'public';
  }
  if (isAuthor) return true;
  return visibility === 'public';
}

async function loadPostForResponse(postId, userId, db = prisma) {
  const post = await db.post.findUnique({
    where: { id: Number(postId) },
    include: buildPostListInclude(userId, { commentsTake: 3 }),
  });
  return post ? serializePostForViewer(post, userId, db) : null;
}

export async function POST(request, { params }) {
  let session = null;
  let sourcePostId = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);
    await ensureUserNotRestricted(session.user.id, 'posting');

    const limit = await enforceRateLimit({ request, policy: 'post_share', actorUserId: session.user.id });
    if (limit) return limit;

    const { id } = await params;
    sourcePostId = Number(id);
    if (!Number.isInteger(sourcePostId) || sourcePostId <= 0) {
      return NextResponse.json({ error: 'Некорректный пост.' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const repostComment = normalizeRepostComment(body?.comment || body?.text || '');
    const targetType = normalizeTargetType(body?.targetType || body?.target_type);
    const profileVisibility = normalizePostVisibility(body?.visibility || 'public', 'public');
    const targetId = targetType === 'community' ? Number(body?.targetId || body?.target_id || 0) : null;

    const sourcePost = await prisma.post.findUnique({
      where: { id: sourcePostId },
      include: {
        community: true,
        repostOf: { include: { community: true } },
      },
    });
    if (!sourcePost) return NextResponse.json({ error: 'Пост не найден.' }, { status: 404 });
    if (!(await canViewerAccessPost(sourcePost, session.user.id, prisma))) {
      return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
    }

    const originalPost = sourcePost.repostOf || sourcePost;
    if (!(await canViewerAccessPost(originalPost, session.user.id, prisma))) {
      return NextResponse.json({ error: 'Оригинальная публикация недоступна.' }, { status: 403 });
    }
    if (!canRepostOriginal(originalPost, session.user.id)) {
      return NextResponse.json({ error: 'Эту публикацию нельзя репостнуть.' }, { status: 403 });
    }

    let targetCommunity = null;
    let targetMembership = null;
    let postVisibility = profileVisibility;
    let postCommunityId = null;

    if (targetType === 'community') {
      if (!Number.isInteger(targetId) || targetId <= 0) {
        return NextResponse.json({ error: 'Выберите сообщество для репоста.' }, { status: 400 });
      }
      targetCommunity = await prisma.community.findUnique({
        where: { id: targetId },
        include: { members: { where: { userId: session.user.id }, take: 1 } },
      });
      targetMembership = targetCommunity?.members?.[0] || null;
      if (targetCommunity && Number(targetCommunity.ownerId || 0) === Number(session.user.id) && !targetMembership) {
        targetMembership = { role: 'owner', status: 'active' };
      }
      if (!targetCommunity || !canPostInCommunity(targetCommunity, targetMembership)) {
        return NextResponse.json({ error: 'У вас нет прав публиковать в этом сообществе.' }, { status: 403 });
      }
      postCommunityId = targetCommunity.id;
      postVisibility = targetCommunity.visibility === 'public' ? 'public' : 'community';
    }

    const existing = await prisma.post.findFirst({
      where: {
        authorId: session.user.id,
        repostOfId: originalPost.id,
        communityId: postCommunityId,
        deletedAt: null,
        status: { not: 'deleted' },
      },
      orderBy: { createdAt: 'desc' },
      include: buildPostListInclude(session.user.id, { commentsTake: 3 }),
    });

    if (existing) {
      return NextResponse.json({
        ok: true,
        already_exists: true,
        post: await serializePostForViewer(existing, session.user.id, prisma),
        original_post: await loadPostForResponse(originalPost.id, session.user.id),
        target_type: targetType,
        target_id: postCommunityId,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const createdPayload = buildPersonalPostPayload({
      media: [],
      source: 'repost',
      extra: {
        repost: true,
        originalPostId: originalPost.id,
        sourcePostId: sourcePost.id,
        targetType,
        targetId: postCommunityId,
        repostComment: repostComment || '',
        repostVisibility: postVisibility,
        communityId: postCommunityId,
        communitySlug: targetCommunity?.slug || null,
        communityName: targetCommunity?.name || null,
        aggregatedIntoFeed: targetType === 'community' ? targetCommunity?.visibility === 'public' : postVisibility !== 'private',
      },
    });

    const created = await prisma.post.create({
      data: {
        authorId: session.user.id,
        communityId: postCommunityId,
        text: repostComment,
        type: 'repost',
        visibility: postVisibility,
        repostOfId: originalPost.id,
        payload: createdPayload,
      },
      include: buildPostListInclude(session.user.id, { commentsTake: 3 }),
    });

    const originalPayload = safePayload(originalPost.payload);
    await prisma.post.update({
      where: { id: originalPost.id },
      data: {
        payload: {
          ...originalPayload,
          profile_reposts: Math.max(0, safeNumber(originalPayload.profile_reposts || originalPayload.profileReposts || 0)) + 1,
        },
      },
    }).catch(() => null);

    if (Number(originalPost.authorId) !== Number(session.user.id)) {
      await createNotification({
        userId: originalPost.authorId,
        actorUserId: session.user.id,
        type: 'post_repost',
        title: 'Вашу публикацию репостнули',
        body: `${session.user.firstName} ${session.user.lastName}`.trim() + ' сделал(а) репост вашей публикации.',
        targetLabel: String(originalPost.text || '').trim().slice(0, 80) || 'Откройте публикацию, чтобы посмотреть репост.',
        entityType: 'post',
        entityId: originalPost.id,
        payload: { postId: originalPost.id, repostId: created.id },
      }).catch(() => null);
    }

    await writeAuditLog({
      request,
      session,
      action: 'post.repost.create',
      entityType: 'post',
      entityId: created.id,
      metadata: { originalPostId: originalPost.id, sourcePostId, hasComment: Boolean(repostComment), targetType, targetId: postCommunityId },
    }).catch(() => null);

    return NextResponse.json({
      ok: true,
      already_exists: false,
      post: await serializePostForViewer(created, session.user.id, prisma),
      original_post: await loadPostForResponse(originalPost.id, session.user.id),
      target_type: targetType,
      target_id: postCommunityId,
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('post/repost failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'post.repost.create',
      entityType: 'post',
      entityId: sourcePostId,
      status: 'error',
      metadata: { message: error?.message || 'unknown_error' },
    }).catch(() => null);
    return NextResponse.json({ error: error?.status && error.status < 500 ? error.message : 'Не удалось сделать репост.' }, { status: error?.status || 500 });
  }
}

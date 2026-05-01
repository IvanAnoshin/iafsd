import prisma from '@/lib/prisma';
import { canViewerAccessPost } from '@/lib/posts';
import { createNotification } from '@/lib/notifications';


async function notifyCommunityModeratorsAboutReport(community, reporterUserId, payload, db = prisma) {
  const communityId = Number(community?.id || 0);
  if (!communityId || !db?.communityMember) return;
  const managers = await db.communityMember.findMany({
    where: { communityId, status: 'active', role: { in: ['owner', 'admin', 'moderator'] } },
    select: { userId: true },
    take: 80,
  }).catch(() => []);
  const ids = [...new Set(managers.map((item) => Number(item.userId)).filter(Boolean))]
    .filter((id) => id !== Number(reporterUserId));
  for (const userId of ids) {
    await createNotification({
      userId,
      actorUserId: reporterUserId,
      type: payload.type || 'community_report',
      title: payload.title || 'Новая жалоба в сообществе',
      body: payload.body || 'Проверьте очередь модерации.',
      targetLabel: community.name,
      entityType: 'community',
      entityId: community.id,
      payload: { slug: community.slug, tab: 'moderation', ...(payload.payload || {}) },
    }, db);
  }
}

function hasPostReportModel(db = prisma) {
  return Boolean(db?.postReport);
}

function hasCommentReportModel(db = prisma) {
  return Boolean(db?.commentReport);
}

function normalizeReason(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 60) : null;
}

function normalizeDetails(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 1000) : null;
}

export function serializePostReport(report) {
  return {
    id: report.id,
    post_id: report.postId,
    reason: report.reason,
    details: report.details,
    status: report.status,
    created_at: report.createdAt,
    updated_at: report.updatedAt,
  };
}


export function serializeCommentReport(report) {
  return {
    id: report.id,
    comment_id: report.commentId,
    reason: report.reason,
    details: report.details,
    status: report.status,
    created_at: report.createdAt,
    updated_at: report.updatedAt,
  };
}

export async function createCommentReport(reporterUserId, commentId, input = {}, db = prisma) {
  if (!hasCommentReportModel(db)) {
    const error = new Error('Модуль жалоб на комментарии ещё не применён к базе данных.');
    error.status = 503;
    throw error;
  }

  const targetCommentId = Number(commentId);
  if (!Number.isInteger(targetCommentId) || targetCommentId <= 0) {
    const error = new Error('Некорректный комментарий.');
    error.status = 400;
    throw error;
  }

  const existingComment = await db.comment.findUnique({
    where: { id: targetCommentId },
    include: { post: { include: { community: true } } },
  });

  if (!existingComment) {
    const error = new Error('Комментарий не найден.');
    error.status = 404;
    throw error;
  }

  if (!(await canViewerAccessPost(existingComment.post, reporterUserId, db))) {
    const error = new Error('Комментарий недоступен.');
    error.status = 403;
    throw error;
  }

  if (Number(existingComment.authorId) === Number(reporterUserId)) {
    const error = new Error('Нельзя пожаловаться на собственный комментарий.');
    error.status = 400;
    throw error;
  }

  const reason = normalizeReason(input?.reason);
  const details = normalizeDetails(input?.details);

  if (!reason) {
    const error = new Error('Выберите причину жалобы.');
    error.status = 400;
    throw error;
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const created = await tx.commentReport.create({
        data: {
          reporterUserId,
          commentId: targetCommentId,
          reason,
          details,
          status: 'new',
        },
      });

      const updatedComment = await tx.comment.update({
        where: { id: targetCommentId },
        data: { reportCount: { increment: 1 } },
        select: { id: true, status: true, reportCount: true },
      });

      let finalStatus = updatedComment.status;
      if (updatedComment.reportCount >= 3 && updatedComment.status === 'visible') {
        const moderated = await tx.comment.update({
          where: { id: targetCommentId },
          data: {
            status: 'under_review',
            moderationReason: 'community_reports',
            hiddenAt: new Date(),
          },
          select: { status: true },
        });
        finalStatus = moderated.status;
      }

      return { report: created, finalStatus };
    });

    if (existingComment.post?.community) {
      await notifyCommunityModeratorsAboutReport(existingComment.post.community, reporterUserId, {
        type: 'community_comment_report',
        title: 'Жалоба на комментарий',
        body: 'Участник отправил жалобу на комментарий в сообществе.',
        payload: { commentId: targetCommentId, postId: existingComment.postId, reportId: result.report.id },
      }, db);
    }

    return { report: serializeCommentReport(result.report), created: true, moderation_status: result.finalStatus };
  } catch (error) {
    if (error?.code === 'P2002') {
      const existing = await db.commentReport.findUnique({
        where: { reporterUserId_commentId: { reporterUserId, commentId: targetCommentId } },
      });
      const current = await db.comment.findUnique({ where: { id: targetCommentId }, select: { status: true } });
      return {
        report: existing ? serializeCommentReport(existing) : null,
        created: false,
        moderation_status: current?.status || existingComment.status,
      };
    }
    throw error;
  }
}
export async function createPostReport(reporterUserId, postId, input = {}, db = prisma) {
  if (!hasPostReportModel(db)) {
    const error = new Error('Модуль жалоб ещё не применён к базе данных.');
    error.status = 503;
    throw error;
  }

  const targetPostId = Number(postId);
  if (!Number.isInteger(targetPostId) || targetPostId <= 0) {
    const error = new Error('Некорректный пост.');
    error.status = 400;
    throw error;
  }

  const existingPost = await db.post.findUnique({ where: { id: targetPostId }, include: { community: true } });
  if (!existingPost) {
    const error = new Error('Пост не найден.');
    error.status = 404;
    throw error;
  }

  if (!(await canViewerAccessPost(existingPost, reporterUserId, db))) {
    const error = new Error('Пост недоступен.');
    error.status = 403;
    throw error;
  }

  if (Number(existingPost.authorId) === Number(reporterUserId)) {
    const error = new Error('Нельзя пожаловаться на собственный пост.');
    error.status = 400;
    throw error;
  }

  const reason = normalizeReason(input?.reason);
  const details = normalizeDetails(input?.details);

  if (!reason) {
    const error = new Error('Выберите причину жалобы.');
    error.status = 400;
    throw error;
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const created = await tx.postReport.create({
        data: {
          reporterUserId,
          postId: targetPostId,
          reason,
          details,
          status: 'new',
        },
      });

      const updatedPost = await tx.post.update({
        where: { id: targetPostId },
        data: { reportCount: { increment: 1 } },
        select: { id: true, status: true, reportCount: true },
      });

      if (updatedPost.reportCount >= 3 && updatedPost.status === 'visible') {
        await tx.post.update({
          where: { id: targetPostId },
          data: { status: 'under_review', moderationReason: 'community_reports', hiddenAt: new Date() },
        });
      }

      return created;
    });
    if (existingPost.community) {
      await notifyCommunityModeratorsAboutReport(existingPost.community, reporterUserId, {
        type: 'community_post_report',
        title: 'Жалоба на пост',
        body: 'Участник отправил жалобу на пост в сообществе.',
        payload: { postId: targetPostId, reportId: result.id },
      }, db);
    }

    return { report: serializePostReport(result), created: true };
  } catch (error) {
    if (error?.code === 'P2002') {
      const existing = await db.postReport.findUnique({
        where: { reporterUserId_postId: { reporterUserId, postId: targetPostId } },
      });
      return { report: existing ? serializePostReport(existing) : null, created: false };
    }
    throw error;
  }
}

const TARGET_REPORT_TYPES = new Set(['profile', 'community']);

export function serializeTargetReport(report) {
  return {
    id: report.id,
    target_type: report.targetType,
    target_id: report.targetId,
    reason: report.reason,
    details: report.details,
    status: report.status,
    created_at: report.createdAt,
    updated_at: report.updatedAt,
  };
}

async function resolveReportTarget(targetType, targetId, db = prisma) {
  const idText = String(targetId || '').trim();
  if (!idText) return null;

  if (targetType === 'profile') {
    const id = Number(idText);
    if (!Number.isInteger(id) || id <= 0) return null;
    const user = await db.user.findUnique({ where: { id }, select: { id: true } });
    return user ? { id: String(user.id) } : null;
  }

  if (targetType === 'community') {
    const id = Number(idText);
    const community = Number.isInteger(id) && id > 0
      ? await db.community.findUnique({ where: { id }, select: { id: true, slug: true } })
      : await db.community.findUnique({ where: { slug: idText.toLowerCase() }, select: { id: true, slug: true } });
    return community ? { id: String(community.id), slug: community.slug } : null;
  }

  return null;
}

export async function createTargetReport(reporterUserId, input = {}, db = prisma) {
  if (!db?.targetReport) {
    const error = new Error('Модуль универсальных жалоб ещё не применён к базе данных.');
    error.status = 503;
    throw error;
  }

  const targetType = String(input?.target_type || input?.targetType || input?.type || '').trim().toLowerCase();
  if (!TARGET_REPORT_TYPES.has(targetType)) {
    const error = new Error('Некорректный тип жалобы.');
    error.status = 400;
    throw error;
  }

  const target = await resolveReportTarget(targetType, input?.target_id || input?.targetId || input?.id, db);
  if (!target) {
    const error = new Error('Объект жалобы не найден.');
    error.status = 404;
    throw error;
  }

  if (targetType === 'profile' && String(target.id) === String(reporterUserId)) {
    const error = new Error('Нельзя пожаловаться на собственный профиль.');
    error.status = 400;
    throw error;
  }

  const reason = normalizeReason(input?.reason);
  const details = normalizeDetails(input?.details);
  if (!reason) {
    const error = new Error('Выберите причину жалобы.');
    error.status = 400;
    throw error;
  }

  try {
    const created = await db.targetReport.create({
      data: {
        reporterUserId,
        targetType,
        targetId: target.id,
        reason,
        details,
        status: 'pending',
      },
    });
    return { report: serializeTargetReport(created), created: true };
  } catch (error) {
    if (error?.code === 'P2002') {
      const existing = await db.targetReport.findUnique({
        where: { reporterUserId_targetType_targetId: { reporterUserId, targetType, targetId: target.id } },
      });
      return { report: existing ? serializeTargetReport(existing) : null, created: false };
    }
    throw error;
  }
}

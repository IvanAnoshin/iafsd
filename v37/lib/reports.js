import prisma from '@/lib/prisma';

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
    select: { id: true, authorId: true, status: true, reportCount: true },
  });

  if (!existingComment) {
    const error = new Error('Комментарий не найден.');
    error.status = 404;
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

  const existingPost = await db.post.findUnique({ where: { id: targetPostId }, select: { id: true } });
  if (!existingPost) {
    const error = new Error('Пост не найден.');
    error.status = 404;
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
    const created = await db.postReport.create({
      data: {
        reporterUserId,
        postId: targetPostId,
        reason,
        details,
        status: 'new',
      },
    });
    return { report: serializePostReport(created), created: true };
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

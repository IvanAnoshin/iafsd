import prisma from '@/lib/prisma';

const commentAuthorSelect = {
  id: true,
  firstName: true,
  lastName: true,
};

export const commentInclude = {
  author: true,
  replyToComment: {
    include: {
      author: {
        select: commentAuthorSelect,
      },
    },
  },
};

export const postWithCommentsInclude = {
  author: true,
  comments: {
    include: commentInclude,
    orderBy: { createdAt: 'desc' },
  },
  votes: true,
  saves: true,
};

function serializeCommentAuthor(author) {
  return author ? {
    id: author.id,
    first_name: author.firstName,
    last_name: author.lastName,
  } : null;
}

function getCommentPlaceholder(status) {
  if (status === 'deleted') return 'Комментарий удалён автором.';
  if (status === 'hidden') return 'Комментарий скрыт модерацией.';
  if (status === 'under_review') return 'Комментарий временно скрыт и отправлен на проверку.';
  return '';
}

function serializeReplyPreview(replyToComment) {
  if (!replyToComment) return null;
  const status = String(replyToComment.status || 'visible');
  const rawText = status === 'visible'
    ? String(replyToComment.text || '').trim().slice(0, 160)
    : getCommentPlaceholder(status);

  return {
    id: replyToComment.id,
    text: rawText,
    author: serializeCommentAuthor(replyToComment.author),
    moderation: {
      status,
      label: getCommentPlaceholder(status) || null,
    },
  };
}

function buildModerationState(comment, currentUserId = null) {
  const status = String(comment?.status || 'visible');
  const isMine = currentUserId ? Number(comment?.authorId) === Number(currentUserId) : false;
  const reportedByMe = Boolean(comment?._reportedByMe);
  const moderationReason = String(comment?.moderationReason || '').trim() || null;
  const label = getCommentPlaceholder(status);

  return {
    status,
    reason: moderationReason,
    label: label || null,
    reported_by_me: reportedByMe,
    can_reply: status === 'visible',
    can_copy: status === 'visible',
    can_vote: status === 'visible',
    can_edit: isMine && status === 'visible',
    can_delete: isMine && status === 'visible',
    can_report: !isMine && status === 'visible',
    is_placeholder: status !== 'visible',
  };
}

export function serializeComment(comment, currentUserId = null) {
  const votes = Array.isArray(comment?.votes)
    ? comment.votes
    : Array.isArray(comment?._votes)
      ? comment._votes
      : [];
  const currentVote = currentUserId
    ? (votes.find((vote) => vote.userId === currentUserId)?.value ?? 0)
    : 0;

  const createdAtMs = comment?.createdAt ? new Date(comment.createdAt).getTime() : 0;
  const updatedAtMs = comment?.updatedAt ? new Date(comment.updatedAt).getTime() : createdAtMs;
  const moderation = buildModerationState(comment, currentUserId);
  const visibleText = moderation.status === 'visible'
    ? comment.text
    : getCommentPlaceholder(moderation.status);

  return {
    id: comment.id,
    text: visibleText,
    raw_text: moderation.status === 'visible' ? comment.text : '',
    created_at: comment.createdAt,
    updated_at: comment.updatedAt || comment.createdAt,
    edited: Boolean(moderation.status === 'visible' && updatedAtMs && createdAtMs && updatedAtMs - createdAtMs > 1000),
    post_id: comment.postId,
    reply_to_comment_id: Number(comment.replyToCommentId || 0) || null,
    reply_to_comment: serializeReplyPreview(comment.replyToComment),
    author: serializeCommentAuthor(comment.author),
    stats: {
      plus: moderation.can_vote ? votes.filter((vote) => Number(vote.value) > 0).length : 0,
      minus: moderation.can_vote ? votes.filter((vote) => Number(vote.value) < 0).length : 0,
    },
    current_vote: moderation.can_vote ? currentVote : 0,
    is_mine: currentUserId ? Number(comment.authorId) === Number(currentUserId) : false,
    moderation,
  };
}

export async function attachCommentVotes(comments, db = prisma) {
  const base = Array.isArray(comments) ? comments : [];
  if (!base.length) return [];
  if (!db?.commentVote) {
    return base.map((comment) => ({ ...comment, votes: Array.isArray(comment?.votes) ? comment.votes : [] }));
  }

  const commentIds = base
    .map((comment) => Number(comment?.id))
    .filter((id) => Number.isFinite(id));

  if (!commentIds.length) {
    return base.map((comment) => ({ ...comment, votes: Array.isArray(comment?.votes) ? comment.votes : [] }));
  }

  let votes = [];
  try {
    votes = await db.commentVote.findMany({
      where: { commentId: { in: commentIds } },
    });
  } catch (error) {
    console.warn('comment votes fallback enabled:', error?.code || error?.message || error);
    return base.map((comment) => ({ ...comment, votes: Array.isArray(comment?.votes) ? comment.votes : [] }));
  }

  const byCommentId = new Map();
  votes.forEach((vote) => {
    const list = byCommentId.get(vote.commentId) || [];
    list.push(vote);
    byCommentId.set(vote.commentId, list);
  });

  return base.map((comment) => ({
    ...comment,
    votes: byCommentId.get(comment.id) || [],
  }));
}

export async function attachCommentViewerFlags(comments, currentUserId = null, db = prisma) {
  const base = Array.isArray(comments) ? comments : [];
  if (!base.length || !currentUserId || !db?.commentReport) return base;

  const commentIds = base
    .map((comment) => Number(comment?.id || 0))
    .filter((id) => id > 0);
  if (!commentIds.length) return base;

  try {
    const reports = await db.commentReport.findMany({
      where: {
        reporterUserId: Number(currentUserId),
        commentId: { in: commentIds },
      },
      select: { commentId: true },
    });
    const reportedIds = new Set(reports.map((report) => Number(report.commentId || 0)).filter(Boolean));
    return base.map((comment) => ({
      ...comment,
      _reportedByMe: reportedIds.has(Number(comment?.id || 0)),
    }));
  } catch (error) {
    console.warn('comment viewer flags fallback enabled:', error?.code || error?.message || error);
    return base;
  }
}

export async function attachCommentVotesToPost(post, db = prisma, currentUserId = null) {
  if (!post || !Array.isArray(post.comments)) return post;
  let comments = await attachCommentVotes(post.comments, db);
  comments = await attachCommentViewerFlags(comments, currentUserId, db);
  return { ...post, comments };
}

export async function attachCommentVotesToPosts(posts, db = prisma, currentUserId = null) {
  const list = Array.isArray(posts) ? posts : [];
  if (!list.length) return [];

  const allComments = list.flatMap((post) => Array.isArray(post.comments) ? post.comments : []);
  let hydratedComments = await attachCommentVotes(allComments, db);
  hydratedComments = await attachCommentViewerFlags(hydratedComments, currentUserId, db);
  const byCommentId = new Map(hydratedComments.map((comment) => [comment.id, comment]));

  return list.map((post) => ({
    ...post,
    comments: Array.isArray(post.comments)
      ? post.comments.map((comment) => byCommentId.get(comment.id) || { ...comment, votes: [] })
      : [],
  }));
}

export async function loadSerializedComments(postId, currentUserId, take = 100) {
  const comments = await prisma.comment.findMany({
    where: { postId },
    orderBy: { createdAt: 'desc' },
    take,
    include: commentInclude,
  });

  let hydrated = await attachCommentVotes(comments, prisma);
  hydrated = await attachCommentViewerFlags(hydrated, currentUserId, prisma);
  return hydrated.map((comment) => serializeComment(comment, currentUserId));
}

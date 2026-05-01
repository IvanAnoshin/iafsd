export function formatCommentAuthorName(author) {
  if (!author) return 'Удалённый пользователь';
  const first = String(author.first_name || '').trim();
  const last = String(author.last_name || '').trim();
  return `${first} ${last}`.trim() || 'Удалённый пользователь';
}

export function getCommentAuthorInitial(author) {
  const label = formatCommentAuthorName(author);
  const initial = String(label || '').trim().charAt(0).toUpperCase();
  return initial || '•';
}

export function isCommentTextLong(text, options = {}) {
  const value = String(text || '').trim();
  if (!value) return false;
  const maxLength = Number(options?.maxLength || 280);
  const maxLines = Number(options?.maxLines || 4);
  return value.length > maxLength || value.split(/\r?\n/).length > maxLines;
}

export function getCollapsedCommentText(text, options = {}) {
  const value = String(text || '').trim();
  if (!value) return '';
  const maxLength = Number(options?.maxLength || 280);
  const maxLines = Number(options?.maxLines || 4);
  const lines = value.split(/\r?\n/);
  const shortened = lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : value;
  if (shortened.length <= maxLength) return shortened;
  return `${shortened.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function normalizeCommentDraft(value) {
  return String(value || '').trim();
}

function getCreatedAtMs(value) {
  const stamp = new Date(value || 0).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
}

export function getCommentRootId(comment, byId = new Map()) {
  if (!comment) return null;
  const directParentId = Number(comment.reply_to_comment_id || 0);
  if (!directParentId) return Number(comment.id || 0) || null;
  const directParent = byId.get(directParentId);
  if (!directParent) return directParentId;
  const nestedParentId = Number(directParent.reply_to_comment_id || 0);
  return nestedParentId || directParentId;
}

export function getCommentReplyTarget(comment, byId = new Map()) {
  const directParentId = Number(comment?.reply_to_comment_id || 0);
  if (!directParentId) return comment?.reply_to_comment || null;
  return byId.get(directParentId) || comment?.reply_to_comment || null;
}

export function buildCommentThreadData(comments) {
  const list = Array.isArray(comments) ? comments.slice() : [];
  const byId = new Map();
  list.forEach((comment) => {
    const commentId = Number(comment?.id || 0);
    if (commentId) byId.set(commentId, comment);
  });

  const repliesByRootId = new Map();
  const topLevelComments = [];

  list.forEach((comment) => {
    const parentId = Number(comment?.reply_to_comment_id || 0);
    if (!parentId) {
      topLevelComments.push(comment);
      return;
    }
    const rootId = getCommentRootId(comment, byId);
    const bucket = repliesByRootId.get(rootId) || [];
    bucket.push(comment);
    repliesByRootId.set(rootId, bucket);
  });

  repliesByRootId.forEach((bucket, rootId) => {
    bucket.sort((left, right) => getCreatedAtMs(left?.created_at) - getCreatedAtMs(right?.created_at));
    repliesByRootId.set(rootId, bucket);
  });

  topLevelComments.sort((left, right) => {
    const leftRootId = Number(left?.id || 0);
    const rightRootId = Number(right?.id || 0);
    const leftReplies = repliesByRootId.get(leftRootId) || [];
    const rightReplies = repliesByRootId.get(rightRootId) || [];
    const leftActivity = Math.max(getCreatedAtMs(left?.created_at), ...leftReplies.map((item) => getCreatedAtMs(item?.created_at)));
    const rightActivity = Math.max(getCreatedAtMs(right?.created_at), ...rightReplies.map((item) => getCreatedAtMs(item?.created_at)));
    return rightActivity - leftActivity;
  });

  return {
    byId,
    topLevelComments,
    repliesByRootId,
  };
}



export function getCommentSortLabel(mode) {
  if (mode === 'latest') return 'Сначала новые';
  if (mode === 'popular') return 'Популярные';
  if (mode === 'author') return 'Ответы автора';
  return 'По обсуждению';
}

function getCommentThreadActivityMs(comment, replies = []) {
  return Math.max(getCreatedAtMs(comment?.created_at), ...replies.map((item) => getCreatedAtMs(item?.created_at)));
}

function getCommentThreadPopularity(comment, replies = []) {
  const rootPlus = Number(comment?.stats?.plus || 0);
  const rootMinus = Number(comment?.stats?.minus || 0);
  const replyPlus = replies.reduce((sum, item) => sum + Number(item?.stats?.plus || 0), 0);
  return rootPlus + replyPlus + replies.length * 2 - rootMinus;
}

export function sortCommentThreads(topLevelComments, repliesByRootId, mode = 'activity', options = {}) {
  const list = Array.isArray(topLevelComments) ? topLevelComments.slice() : [];
  const postAuthorId = Number(options?.postAuthorId || 0);

  list.sort((left, right) => {
    const leftId = Number(left?.id || 0);
    const rightId = Number(right?.id || 0);
    const leftReplies = repliesByRootId.get(leftId) || [];
    const rightReplies = repliesByRootId.get(rightId) || [];
    const leftActivity = getCommentThreadActivityMs(left, leftReplies);
    const rightActivity = getCommentThreadActivityMs(right, rightReplies);

    if (mode === 'latest') {
      const leftCreated = getCreatedAtMs(left?.created_at);
      const rightCreated = getCreatedAtMs(right?.created_at);
      if (rightCreated !== leftCreated) return rightCreated - leftCreated;
      return rightActivity - leftActivity;
    }

    if (mode === 'popular') {
      const leftPopularity = getCommentThreadPopularity(left, leftReplies);
      const rightPopularity = getCommentThreadPopularity(right, rightReplies);
      if (rightPopularity !== leftPopularity) return rightPopularity - leftPopularity;
      return rightActivity - leftActivity;
    }

    if (mode === 'author' && postAuthorId > 0) {
      const leftHasAuthor = Number(left?.author?.id || 0) == postAuthorId || leftReplies.some((item) => Number(item?.author?.id || 0) == postAuthorId);
      const rightHasAuthor = Number(right?.author?.id || 0) == postAuthorId || rightReplies.some((item) => Number(item?.author?.id || 0) == postAuthorId);
      if (leftHasAuthor !== rightHasAuthor) return leftHasAuthor ? -1 : 1;
      return rightActivity - leftActivity;
    }

    return rightActivity - leftActivity;
  });

  return list;
}

export function getRemainingCommentThreadCount(sortedTopLevelComments, visibleCount) {
  const total = Array.isArray(sortedTopLevelComments) ? sortedTopLevelComments.length : 0;
  return Math.max(0, total - Number(visibleCount || 0));
}

export function isCommentFresh(comment, now = Date.now(), maxAgeMinutes = 45) {
  const createdAtMs = getCreatedAtMs(comment?.created_at);
  if (!createdAtMs) return false;
  const ageMs = Math.max(0, Number(now || 0) - createdAtMs);
  return ageMs <= maxAgeMinutes * 60 * 1000;
}

export function getCommentSocialSignals(comment, options = {}) {
  const {
    postAuthorId = null,
    replyCount = 0,
    now = Date.now(),
  } = options || {};

  const signals = [];
  const authorId = Number(comment?.author?.id || 0);
  const normalizedPostAuthorId = Number(postAuthorId || 0);
  const likeCount = Number(comment?.stats?.plus || 0);
  const normalizedReplyCount = Number(replyCount || 0);

  if (Boolean(comment?.is_mine)) {
    signals.push({ key: 'mine', label: 'Вы', tone: 'accent' });
  } else if (normalizedPostAuthorId > 0 && authorId === normalizedPostAuthorId) {
    signals.push({ key: 'author', label: 'Автор поста', tone: 'accent' });
  }

  if (likeCount >= 3) {
    signals.push({ key: 'popular', label: 'Популярный', tone: 'success' });
  } else if (normalizedReplyCount >= 2) {
    signals.push({ key: 'thread', label: 'Обсуждение', tone: 'blue' });
  }

  if (signals.length < 2 && isCommentFresh(comment, now)) {
    signals.push({ key: 'fresh', label: 'Новый', tone: 'neutral' });
  }

  return signals.slice(0, 2);
}
export function getCommentThreadToggleLabel(count, expanded) {
  const numericCount = Number(count || 0);
  if (expanded) return 'Скрыть ответы';
  const suffix = numericCount === 1 ? 'ответ' : numericCount >= 2 && numericCount <= 4 ? 'ответа' : 'ответов';
  return `Показать ${numericCount} ${suffix}`;
}


export function getCommentModerationStatus(comment) {
  return String(comment?.moderation?.status || 'visible');
}

export function isCommentVisible(comment) {
  return getCommentModerationStatus(comment) === 'visible';
}

export function getCommentModerationLabel(comment) {
  const status = getCommentModerationStatus(comment);
  if (status === 'deleted') return 'Удалён';
  if (status === 'under_review') return 'На проверке';
  if (status === 'hidden') return 'Скрыт';
  return '';
}

export function getCommentModerationTone(comment) {
  const status = getCommentModerationStatus(comment);
  if (status === 'deleted') return 'neutral';
  if (status === 'under_review') return 'warning';
  if (status === 'hidden') return 'danger';
  return 'accent';
}

export function getCommentModerationHint(comment) {
  if (comment?.moderation?.reported_by_me && isCommentVisible(comment)) {
    return 'Жалоба отправлена';
  }
  if (comment?.moderation?.label) return comment.moderation.label;
  return '';
}

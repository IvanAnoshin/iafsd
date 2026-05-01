import prisma from '@/lib/prisma';
import { createNotification } from '@/lib/notifications';


async function notifyReportStatus(row, kind, db = prisma) {
  const reporterId = Number(row?.reporterUserId || row?.reporterUser?.id || 0);
  if (!reporterId) return;
  const statusLabels = {
    pending: 'Жалоба возвращена в очередь.',
    in_review: 'Жалоба взята в работу.',
    resolved: 'Жалоба рассмотрена.',
    rejected: 'Жалоба закрыта без действий.',
    escalated: 'Жалоба передана на дополнительную проверку.',
    reviewed: 'Жалоба рассмотрена.',
    dismissed: 'Жалоба закрыта без действий.',
    actioned: 'По жалобе приняты меры.',
    new: 'Жалоба возвращена в очередь.',
  };
  await createNotification({
    userId: reporterId,
    actorUserId: null,
    allowSelf: true,
    type: kind === 'message' ? 'message_report_status' : 'post_report_status',
    title: 'Статус жалобы обновлён',
    body: statusLabels[row.status] || 'Статус вашей жалобы изменился.',
    targetLabel: kind === 'message' ? 'Жалоба на сообщение' : 'Жалоба на публикацию',
    entityType: kind === 'message' ? 'message_report' : 'post_report',
    entityId: row.id,
    payload: kind === 'message'
      ? { conversationId: row.message?.conversationId || null, reportId: row.id }
      : { postId: row.postId || row.post?.id || null, reportId: row.id },
  }, db);
}

function safeLimit(value, fallback = 20, max = 100) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.trunc(num), 1), max);
}

function safeOffset(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.trunc(num);
}

function normalizeStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw || '';
}

const GLOBAL_REPORT_STATUSES = new Set(['pending', 'in_review', 'resolved', 'rejected', 'escalated']);
const LEGACY_REPORT_STATUSES = new Set(['new', 'reviewed', 'dismissed', 'actioned', 'open', 'closed']);

function normalizeReportStatus(value) {
  const raw = normalizeStatus(value);
  if (!raw) return 'resolved';
  if (GLOBAL_REPORT_STATUSES.has(raw) || LEGACY_REPORT_STATUSES.has(raw)) return raw;
  return null;
}

function toGlobalReportStatus(value) {
  const raw = normalizeStatus(value);
  if (raw === 'new' || raw === 'open') return 'pending';
  if (raw === 'reviewed' || raw === 'actioned' || raw === 'closed') return 'resolved';
  if (raw === 'dismissed') return 'rejected';
  if (GLOBAL_REPORT_STATUSES.has(raw)) return raw;
  return raw || 'pending';
}

function statusFilterValues(status) {
  const raw = normalizeStatus(status);
  if (!raw || raw === 'all') return null;
  if (raw === 'pending') return ['pending', 'new', 'open'];
  if (raw === 'resolved') return ['resolved', 'reviewed', 'actioned', 'closed'];
  if (raw === 'rejected') return ['rejected', 'dismissed'];
  return [raw];
}

function buildStatusWhere(status) {
  const values = statusFilterValues(status);
  return values ? { status: { in: values } } : {};
}

function normalizeTicketStatus(value) {
  const raw = normalizeStatus(value);
  if (!raw) return 'closed';
  return new Set(['open', 'in_progress', 'closed']).has(raw) ? raw : null;
}

function buildUserName(user) {
  if (!user) return 'Пользователь';
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Пользователь';
}

function buildHandle(user) {
  const handle = user?.publicProfile?.handle || user?.normalizedKey || '';
  return handle ? `@${String(handle).replace(/^@+/, '')}` : null;
}

function serializeReport(row) {
  return {
    id: row.id,
    status: row.status,
    global_status: toGlobalReportStatus(row.status),
    reason: row.reason,
    details: row.details,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    reporter: row.reporterUser ? {
      id: row.reporterUser.id,
      full_name: buildUserName(row.reporterUser),
      handle: buildHandle(row.reporterUser),
    } : null,
    post: row.post ? {
      id: row.post.id,
      text_preview: String(row.post.text || '').trim().slice(0, 180),
      created_at: row.post.createdAt,
      author: row.post.author ? {
        id: row.post.author.id,
        full_name: buildUserName(row.post.author),
        handle: buildHandle(row.post.author),
      } : null,
      community: row.post.community ? {
        id: row.post.community.id,
        slug: row.post.community.slug,
        name: row.post.community.name,
      } : null,
    } : null,
  };
}

function serializeTicket(row) {
  return {
    id: row.id,
    category: row.category,
    subject: row.subject,
    message: row.message,
    status: row.status,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    user: row.user ? {
      id: row.user.id,
      full_name: buildUserName(row.user),
      handle: buildHandle(row.user),
    } : null,
  };
}

export async function listAdminPostReports({ status = '', limit = 20, offset = 0 } = {}, db = prisma) {
  if (!db?.postReport) return { items: [], total: 0, limit: safeLimit(limit), offset: safeOffset(offset) };
  const where = buildStatusWhere(status);
  const take = safeLimit(limit);
  const skip = safeOffset(offset);
  const [total, rows] = await Promise.all([
    db.postReport.count({ where }),
    db.postReport.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take,
      skip,
      include: {
        reporterUser: { include: { publicProfile: true } },
        post: { include: { author: { include: { publicProfile: true } }, community: true } },
      },
    }),
  ]);
  return { items: rows.map(serializeReport), total, limit: take, offset: skip };
}

export async function updateAdminPostReportStatus(id, status, db = prisma) {
  if (!db?.postReport) {
    const error = new Error('Модуль жалоб ещё не применён к базе данных.');
    error.status = 503;
    throw error;
  }
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    const error = new Error('Некорректная жалоба.');
    error.status = 400;
    throw error;
  }
  const nextStatus = normalizeReportStatus(status);
  if (!nextStatus) {
    const error = new Error('Некорректный статус жалобы.');
    error.status = 400;
    throw error;
  }
  const updated = await db.postReport.update({
    where: { id: targetId },
    data: { status: nextStatus },
    include: {
      reporterUser: { include: { publicProfile: true } },
      post: { include: { author: { include: { publicProfile: true } }, community: true } },
    },
  }).catch((error) => {
    if (error?.code === 'P2025') {
      const wrapped = new Error('Жалоба не найдена.');
      wrapped.status = 404;
      throw wrapped;
    }
    throw error;
  });
  await notifyReportStatus(updated, 'post', db);
  return serializeReport(updated);
}

export async function listAdminSupportTickets({ status = '', limit = 20, offset = 0 } = {}, db = prisma) {
  if (!db?.supportTicket) return { items: [], total: 0, limit: safeLimit(limit), offset: safeOffset(offset) };
  const normalized = normalizeStatus(status);
  const where = normalized ? { status: normalized } : {};
  const take = safeLimit(limit);
  const skip = safeOffset(offset);
  const [total, rows] = await Promise.all([
    db.supportTicket.count({ where }),
    db.supportTicket.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take,
      skip,
      include: {
        user: { include: { publicProfile: true } },
      },
    }),
  ]);
  return { items: rows.map(serializeTicket), total, limit: take, offset: skip };
}

export async function updateAdminSupportTicketStatus(id, status, db = prisma) {
  if (!db?.supportTicket) {
    const error = new Error('Модуль поддержки ещё не применён к базе данных.');
    error.status = 503;
    throw error;
  }
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    const error = new Error('Некорректный тикет.');
    error.status = 400;
    throw error;
  }
  const nextStatus = normalizeTicketStatus(status);
  if (!nextStatus) {
    const error = new Error('Некорректный статус тикета.');
    error.status = 400;
    throw error;
  }
  const updated = await db.supportTicket.update({
    where: { id: targetId },
    data: { status: nextStatus },
    include: { user: { include: { publicProfile: true } } },
  }).catch((error) => {
    if (error?.code === 'P2025') {
      const wrapped = new Error('Тикет не найден.');
      wrapped.status = 404;
      throw wrapped;
    }
    throw error;
  });
  return serializeTicket(updated);
}

function serializeMessageReport(row) {
  return {
    id: row.id,
    status: row.status,
    global_status: toGlobalReportStatus(row.status),
    reason: row.reason,
    details: row.details,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    reporter: row.reporterUser ? {
      id: row.reporterUser.id,
      full_name: buildUserName(row.reporterUser),
      handle: buildHandle(row.reporterUser),
    } : null,
    message: row.message ? {
      id: row.message.id,
      type: row.message.type,
      text_preview: String(row.message.text || '').trim().slice(0, 180),
      conversation_id: row.message.conversationId,
      created_at: row.message.createdAt,
      sender: row.message.sender ? {
        id: row.message.sender.id,
        full_name: buildUserName(row.message.sender),
        handle: buildHandle(row.message.sender),
      } : null,
    } : null,
  };
}

function serializeSafetyFlag(row) {
  return {
    id: row.id,
    category: row.category,
    reason: row.reason,
    severity: row.severity,
    status: row.status,
    global_status: toGlobalReportStatus(row.status),
    occurrence_count: row.occurrenceCount,
    conversation_id: row.conversationId,
    message_id: row.messageId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    last_triggered_at: row.lastTriggeredAt,
    resolved_at: row.resolvedAt,
    actor: row.actorUser ? {
      id: row.actorUser.id,
      full_name: buildUserName(row.actorUser),
      handle: buildHandle(row.actorUser),
    } : null,
    target: row.targetUser ? {
      id: row.targetUser.id,
      full_name: buildUserName(row.targetUser),
      handle: buildHandle(row.targetUser),
    } : null,
    details: row.details || null,
  };
}

export async function listAdminMessageReports({ status = '', limit = 20, offset = 0 } = {}, db = prisma) {
  if (!db?.chatMessageReport) return { items: [], total: 0, limit: safeLimit(limit), offset: safeOffset(offset) };
  const where = buildStatusWhere(status);
  const take = safeLimit(limit);
  const skip = safeOffset(offset);
  const [total, rows] = await Promise.all([
    db.chatMessageReport.count({ where }),
    db.chatMessageReport.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take,
      skip,
      include: {
        reporterUser: { include: { publicProfile: true } },
        message: { include: { sender: { include: { publicProfile: true } } } },
      },
    }),
  ]);
  return { items: rows.map(serializeMessageReport), total, limit: take, offset: skip };
}

export async function updateAdminMessageReportStatus(id, status, db = prisma) {
  if (!db?.chatMessageReport) {
    const error = new Error('Модуль жалоб на сообщения ещё не применён к базе данных.');
    error.status = 503;
    throw error;
  }
  const targetId = String(id || '').trim();
  if (!targetId) {
    const error = new Error('Некорректная жалоба.');
    error.status = 400;
    throw error;
  }
  const nextStatus = normalizeReportStatus(status);
  if (!nextStatus) {
    const error = new Error('Некорректный статус жалобы.');
    error.status = 400;
    throw error;
  }
  const updated = await db.chatMessageReport.update({
    where: { id: targetId },
    data: { status: nextStatus },
    include: {
      reporterUser: { include: { publicProfile: true } },
      message: { include: { sender: { include: { publicProfile: true } } } },
    },
  }).catch((error) => {
    if (error?.code === 'P2025') {
      const wrapped = new Error('Жалоба не найдена.');
      wrapped.status = 404;
      throw wrapped;
    }
    throw error;
  });
  await notifyReportStatus(updated, 'message', db);
  return serializeMessageReport(updated);
}

export async function listAdminMessengerSafetyFlags({ status = '', limit = 20, offset = 0 } = {}, db = prisma) {
  if (!db?.messengerSafetyFlag) return { items: [], total: 0, limit: safeLimit(limit), offset: safeOffset(offset) };
  const where = buildStatusWhere(status);
  const take = safeLimit(limit);
  const skip = safeOffset(offset);
  const [total, rows] = await Promise.all([
    db.messengerSafetyFlag.count({ where }),
    db.messengerSafetyFlag.findMany({
      where,
      orderBy: [{ lastTriggeredAt: 'desc' }, { createdAt: 'desc' }],
      take,
      skip,
      include: {
        actorUser: { include: { publicProfile: true } },
        targetUser: { include: { publicProfile: true } },
      },
    }),
  ]);
  return { items: rows.map(serializeSafetyFlag), total, limit: take, offset: skip };
}

export async function updateAdminMessengerSafetyFlagStatus(id, status, db = prisma) {
  if (!db?.messengerSafetyFlag) {
    const error = new Error('Safety-флаги мессенджера ещё не применены к базе данных.');
    error.status = 503;
    throw error;
  }
  const targetId = String(id || '').trim();
  if (!targetId) {
    const error = new Error('Некорректный safety-флаг.');
    error.status = 400;
    throw error;
  }
  const nextStatus = normalizeReportStatus(status);
  if (!nextStatus) {
    const error = new Error('Некорректный статус safety-флага.');
    error.status = 400;
    throw error;
  }
  const updated = await db.messengerSafetyFlag.update({
    where: { id: targetId },
    data: {
      status: nextStatus,
      resolvedAt: ['dismissed', 'actioned', 'resolved', 'rejected'].includes(nextStatus) ? new Date() : null,
    },
    include: {
      actorUser: { include: { publicProfile: true } },
      targetUser: { include: { publicProfile: true } },
    },
  }).catch((error) => {
    if (error?.code === 'P2025') {
      const wrapped = new Error('Safety-флаг не найден.');
      wrapped.status = 404;
      throw wrapped;
    }
    throw error;
  });
  return serializeSafetyFlag(updated);
}

function serializeCommentReport(row) {
  return {
    id: row.id,
    status: row.status,
    global_status: toGlobalReportStatus(row.status),
    reason: row.reason,
    details: row.details,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    reporter: row.reporterUser ? {
      id: row.reporterUser.id,
      full_name: buildUserName(row.reporterUser),
      handle: buildHandle(row.reporterUser),
    } : null,
    comment: row.comment ? {
      id: row.comment.id,
      text_preview: String(row.comment.text || '').trim().slice(0, 180),
      post_id: row.comment.postId,
      created_at: row.comment.createdAt,
      author: row.comment.author ? {
        id: row.comment.author.id,
        full_name: buildUserName(row.comment.author),
        handle: buildHandle(row.comment.author),
      } : null,
      community: row.comment.post?.community ? {
        id: row.comment.post.community.id,
        slug: row.comment.post.community.slug,
        name: row.comment.post.community.name,
      } : null,
    } : null,
  };
}

function serializeTargetReport(row) {
  return {
    id: row.id,
    status: row.status,
    global_status: toGlobalReportStatus(row.status),
    reason: row.reason,
    details: row.details,
    target_type: row.targetType,
    target_id: row.targetId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    reporter: row.reporterUser ? {
      id: row.reporterUser.id,
      full_name: buildUserName(row.reporterUser),
      handle: buildHandle(row.reporterUser),
    } : null,
  };
}

function moderationQueueItem(kind, item) {
  return {
    queue_id: `${kind}:${item.id}`,
    kind,
    id: item.id,
    status: item.status,
    global_status: item.global_status || toGlobalReportStatus(item.status),
    reason: item.reason || item.category || null,
    details: item.details || null,
    created_at: item.created_at || item.createdAt,
    updated_at: item.updated_at || item.updatedAt || item.last_triggered_at || null,
    reporter: item.reporter || null,
    actor: item.actor || null,
    target: item.target || item.post || item.comment || item.message || null,
    raw: item,
  };
}

function sortQueueItems(items) {
  return items.sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
}

async function updateReportStatus(model, id, status, db = prisma) {
  const nextStatus = normalizeReportStatus(status);
  if (!nextStatus) {
    const error = new Error('Некорректный статус модерации.');
    error.status = 400;
    throw error;
  }
  return model.update({ where: { id }, data: { status: nextStatus } });
}

export async function listAdminCommentReports({ status = '', limit = 20, offset = 0 } = {}, db = prisma) {
  if (!db?.commentReport) return { items: [], total: 0, limit: safeLimit(limit), offset: safeOffset(offset) };
  const where = buildStatusWhere(status);
  const take = safeLimit(limit);
  const skip = safeOffset(offset);
  const [total, rows] = await Promise.all([
    db.commentReport.count({ where }),
    db.commentReport.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take,
      skip,
      include: {
        reporterUser: { include: { publicProfile: true } },
        comment: { include: { author: { include: { publicProfile: true } }, post: { include: { community: true } } } },
      },
    }),
  ]);
  return { items: rows.map(serializeCommentReport), total, limit: take, offset: skip };
}

export async function updateAdminCommentReportStatus(id, status, db = prisma) {
  if (!db?.commentReport) {
    const error = new Error('Модуль жалоб на комментарии ещё не применён к базе данных.');
    error.status = 503;
    throw error;
  }
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    const error = new Error('Некорректная жалоба.');
    error.status = 400;
    throw error;
  }
  const nextStatus = normalizeReportStatus(status);
  if (!nextStatus) {
    const error = new Error('Некорректный статус жалобы.');
    error.status = 400;
    throw error;
  }
  const updated = await db.commentReport.update({
    where: { id: targetId },
    data: { status: nextStatus },
    include: {
      reporterUser: { include: { publicProfile: true } },
      comment: { include: { author: { include: { publicProfile: true } }, post: { include: { community: true } } } },
    },
  }).catch((error) => {
    if (error?.code === 'P2025') {
      const wrapped = new Error('Жалоба не найдена.');
      wrapped.status = 404;
      throw wrapped;
    }
    throw error;
  });
  await notifyReportStatus(updated, 'comment', db);
  return serializeCommentReport(updated);
}

export async function listAdminTargetReports({ status = '', limit = 20, offset = 0 } = {}, db = prisma) {
  if (!db?.targetReport) return { items: [], total: 0, limit: safeLimit(limit), offset: safeOffset(offset) };
  const where = buildStatusWhere(status);
  const take = safeLimit(limit);
  const skip = safeOffset(offset);
  const [total, rows] = await Promise.all([
    db.targetReport.count({ where }),
    db.targetReport.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take,
      skip,
      include: { reporterUser: { include: { publicProfile: true } } },
    }),
  ]);
  return { items: rows.map(serializeTargetReport), total, limit: take, offset: skip };
}

export async function updateAdminTargetReportStatus(id, status, db = prisma) {
  if (!db?.targetReport) {
    const error = new Error('Модуль универсальных жалоб ещё не применён к базе данных.');
    error.status = 503;
    throw error;
  }
  const targetId = String(id || '').trim();
  if (!targetId) {
    const error = new Error('Некорректная жалоба.');
    error.status = 400;
    throw error;
  }
  const nextStatus = normalizeReportStatus(status);
  if (!nextStatus) {
    const error = new Error('Некорректный статус жалобы.');
    error.status = 400;
    throw error;
  }
  const updated = await db.targetReport.update({
    where: { id: targetId },
    data: { status: nextStatus },
    include: { reporterUser: { include: { publicProfile: true } } },
  }).catch((error) => {
    if (error?.code === 'P2025') {
      const wrapped = new Error('Жалоба не найдена.');
      wrapped.status = 404;
      throw wrapped;
    }
    throw error;
  });
  return serializeTargetReport(updated);
}

export async function listGlobalModerationQueue({ status = 'pending', type = 'all', limit = 30, offset = 0 } = {}, db = prisma) {
  const take = safeLimit(limit, 30, 100);
  const skip = safeOffset(offset);
  const wantedType = String(type || 'all').trim().toLowerCase();
  const includeType = (value) => wantedType === 'all' || wantedType === value;

  const tasks = [];
  if (includeType('post_report')) tasks.push(listAdminPostReports({ status, limit: take, offset: 0 }, db).then((payload) => payload.items.map((item) => moderationQueueItem('post_report', item))));
  if (includeType('comment_report')) tasks.push(listAdminCommentReports({ status, limit: take, offset: 0 }, db).then((payload) => payload.items.map((item) => moderationQueueItem('comment_report', item))));
  if (includeType('message_report')) tasks.push(listAdminMessageReports({ status, limit: take, offset: 0 }, db).then((payload) => payload.items.map((item) => moderationQueueItem('message_report', item))));
  if (includeType('target_report')) tasks.push(listAdminTargetReports({ status, limit: take, offset: 0 }, db).then((payload) => payload.items.map((item) => moderationQueueItem('target_report', item))));
  if (includeType('safety_flag')) tasks.push(listAdminMessengerSafetyFlags({ status, limit: take, offset: 0 }, db).then((payload) => payload.items.map((item) => moderationQueueItem('safety_flag', item))));

  const groups = await Promise.all(tasks);
  const items = sortQueueItems(groups.flat());
  return {
    items: items.slice(skip, skip + take),
    total: items.length,
    limit: take,
    offset: skip,
    status: status || 'all',
    type: wantedType,
  };
}

function normalizeModerationAction(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeReasonInput(value) {
  const text = String(value || '').trim().slice(0, 240);
  return text || null;
}

function buildRestrictionExpiry(input = {}) {
  const hours = Number(input.duration_hours || input.durationHours || 0);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return new Date(Date.now() + Math.min(Math.trunc(hours), 24 * 365) * 3600_000);
}

async function notifyModeratedUser(userId, actorUserId, action, reason, db = prisma) {
  const labels = {
    warn: 'Предупреждение модератора',
    mute: 'Временное ограничение',
    ban: 'Аккаунт ограничен',
    unmute: 'Ограничение снято',
    unban: 'Ограничение снято',
  };
  await createNotification({
    userId,
    actorUserId,
    allowSelf: false,
    type: `moderation_${action}`,
    title: labels[action] || 'Решение модерации',
    body: reason || 'Модератор обновил ограничения аккаунта.',
    targetLabel: 'Аккаунт',
    entityType: 'user',
    entityId: userId,
    payload: { action },
  }, db).catch(() => null);
}

async function applyContentModeration(entityType, entityId, action, reason, db = prisma) {
  if (entityType === 'post') {
    const data = action === 'restore'
      ? { status: 'visible', moderationReason: null, hiddenAt: null, deletedAt: null }
      : action === 'delete'
        ? { status: 'deleted', moderationReason: reason || 'global_moderation', deletedAt: new Date(), isPinned: false }
        : { status: 'hidden', moderationReason: reason || 'global_moderation', hiddenAt: new Date() };
    return db.post.update({ where: { id: Number(entityId) }, data });
  }

  if (entityType === 'comment') {
    const data = action === 'restore'
      ? { status: 'visible', moderationReason: null, hiddenAt: null, deletedAt: null }
      : action === 'delete'
        ? { status: 'deleted', moderationReason: reason || 'global_moderation', deletedAt: new Date(), text: '' }
        : { status: 'hidden', moderationReason: reason || 'global_moderation', hiddenAt: new Date() };
    return db.comment.update({ where: { id: Number(entityId) }, data });
  }

  if (entityType === 'message') {
    const data = action === 'restore'
      ? { deletedAt: null, deletedForAllAt: null, metadata: { restoredByModeration: true } }
      : { deletedAt: new Date(), deletedForAllAt: new Date(), text: '', metadata: { deletedByModeration: true, reason: reason || null } };
    return db.chatMessage.update({ where: { id: String(entityId) }, data });
  }

  const error = new Error('Этот тип контента не поддерживает такое действие.');
  error.status = 400;
  throw error;
}

async function applyUserModeration(actorUserId, userId, action, input = {}, db = prisma) {
  const targetUserId = Number(userId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    const error = new Error('Некорректный пользователь.');
    error.status = 400;
    throw error;
  }
  const reason = normalizeReasonInput(input.reason);
  const surface = String(input.surface || 'global').trim().toLowerCase() || 'global';

  if (action === 'warn') {
    await notifyModeratedUser(targetUserId, actorUserId, 'warn', reason, db);
    return { user_id: targetUserId, action, reason };
  }

  if (!db?.userModerationRestriction) {
    const error = new Error('Модуль ограничений пользователей ещё не применён к базе данных.');
    error.status = 503;
    throw error;
  }

  if (action === 'mute' || action === 'ban') {
    const restriction = await db.userModerationRestriction.create({
      data: {
        userId: targetUserId,
        type: action,
        surface: action === 'ban' ? 'global' : surface,
        reason,
        createdByUserId: actorUserId || null,
        expiresAt: buildRestrictionExpiry(input),
        metadata: { source: 'global_moderation' },
      },
    });
    await notifyModeratedUser(targetUserId, actorUserId, action, reason, db);
    return restriction;
  }

  if (action === 'unmute' || action === 'unban') {
    const type = action === 'unmute' ? 'mute' : 'ban';
    await db.userModerationRestriction.updateMany({
      where: { userId: targetUserId, type, status: 'active' },
      data: { status: 'lifted', liftedAt: new Date() },
    });
    await notifyModeratedUser(targetUserId, actorUserId, action, reason, db);
    return { user_id: targetUserId, action, type, status: 'lifted' };
  }

  const error = new Error('Некорректное действие с пользователем.');
  error.status = 400;
  throw error;
}

export async function applyGlobalModerationAction(actorUserId, input = {}, db = prisma) {
  const action = normalizeModerationAction(input.action);
  const entityType = String(input.entity_type || input.entityType || '').trim().toLowerCase();
  const entityId = input.entity_id ?? input.entityId;
  const reason = normalizeReasonInput(input.reason);

  if (!action) {
    const error = new Error('Укажите действие модерации.');
    error.status = 400;
    throw error;
  }

  if (action === 'set_status') {
    const status = input.status || input.global_status || input.globalStatus;
    if (entityType === 'post_report') return { report: await updateAdminPostReportStatus(entityId, status, db) };
    if (entityType === 'comment_report') return { report: await updateAdminCommentReportStatus(entityId, status, db) };
    if (entityType === 'message_report') return { report: await updateAdminMessageReportStatus(entityId, status, db) };
    if (entityType === 'target_report') return { report: await updateAdminTargetReportStatus(entityId, status, db) };
    if (entityType === 'safety_flag') return { flag: await updateAdminMessengerSafetyFlagStatus(entityId, status, db) };
  }

  if (['hide', 'delete', 'restore'].includes(action)) {
    const entity = await applyContentModeration(entityType, entityId, action, reason, db);
    return { entity_type: entityType, entity_id: String(entityId), action, entity };
  }

  if (['warn', 'mute', 'ban', 'unmute', 'unban'].includes(action)) {
    return { restriction: await applyUserModeration(actorUserId, entityId, action, input, db) };
  }

  const error = new Error('Некорректное действие модерации.');
  error.status = 400;
  throw error;
}

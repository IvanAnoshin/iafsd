import prisma from '@/lib/prisma';

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

function normalizeReportStatus(value) {
  const raw = normalizeStatus(value);
  if (!raw) return 'reviewed';
  return new Set(['new', 'reviewed', 'dismissed', 'actioned']).has(raw) ? raw : null;
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
  const normalized = normalizeStatus(status);
  const where = normalized ? { status: normalized } : {};
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
        post: { include: { author: { include: { publicProfile: true } } } },
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
      post: { include: { author: { include: { publicProfile: true } } } },
    },
  }).catch((error) => {
    if (error?.code === 'P2025') {
      const wrapped = new Error('Жалоба не найдена.');
      wrapped.status = 404;
      throw wrapped;
    }
    throw error;
  });
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
  const normalized = normalizeStatus(status);
  const where = normalized ? { status: normalized } : {};
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
  return serializeMessageReport(updated);
}

export async function listAdminMessengerSafetyFlags({ status = '', limit = 20, offset = 0 } = {}, db = prisma) {
  if (!db?.messengerSafetyFlag) return { items: [], total: 0, limit: safeLimit(limit), offset: safeOffset(offset) };
  const normalized = normalizeStatus(status);
  const where = normalized ? { status: normalized } : {};
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
      resolvedAt: ['dismissed', 'actioned'].includes(nextStatus) ? new Date() : null,
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

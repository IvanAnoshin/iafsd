import prisma from '@/lib/prisma';

function hasSupportTicketModel(db = prisma) {
  return Boolean(db?.supportTicket);
}

function normalizeShortText(value, max) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.slice(0, max);
}

function normalizeContext(input) {
  if (!input || typeof input !== 'object') return [];
  const allowed = ['source', 'path', 'viewport', 'severity'];
  const rows = [];
  for (const key of allowed) {
    const value = normalizeShortText(input[key], key === 'path' ? 180 : 80);
    if (value) rows.push(`${key}: ${value}`);
  }
  return rows;
}

function buildTicketMessage(message, input) {
  const contextRows = normalizeContext(input?.context);
  if (!contextRows.length) return message;
  return `${message}\n\n---\nКонтекст: ${contextRows.join('; ')}`.slice(0, 2000);
}

function serializeTicket(ticket) {
  return {
    id: ticket.id,
    category: ticket.category,
    subject: ticket.subject,
    message: ticket.message,
    status: ticket.status,
    created_at: ticket.createdAt,
    updated_at: ticket.updatedAt,
  };
}

export async function createSupportTicket(userId, input, db = prisma) {
  if (!hasSupportTicketModel(db)) {
    const error = new Error('Модуль поддержки ещё не применён к базе данных.');
    error.status = 503;
    throw error;
  }

  const category = normalizeShortText(input?.category, 40) || 'general';
  const subject = normalizeShortText(input?.subject, 140);
  const message = normalizeShortText(input?.message, 2000);

  if (!message || message.length < 10) {
    const error = new Error('Опишите проблему хотя бы в 10 символах.');
    error.status = 400;
    throw error;
  }

  const created = await db.supportTicket.create({
    data: {
      userId,
      category,
      subject: subject || 'Без темы',
      message: buildTicketMessage(message, input),
      status: 'open',
    },
  });

  return serializeTicket(created);
}

export async function listSupportTickets(userId, options = {}, db = prisma) {
  if (!hasSupportTicketModel(db)) return { items: [], count: 0 };

  const take = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
  const rows = await db.supportTicket.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
  });

  return {
    items: rows.map(serializeTicket),
    count: rows.length,
  };
}

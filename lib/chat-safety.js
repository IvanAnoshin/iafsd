import prisma from '@/lib/prisma';
import { emitUsersEvent } from '@/lib/chat-realtime';
import { emitUnreadSummary } from '@/lib/realtime-sync';

function readPositiveInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

const CONVERSATION_BURST_WINDOW_MS = readPositiveInt('CHAT_RATE_LIMIT_CONVERSATION_WINDOW_MS', 12_000);
const CONVERSATION_BURST_LIMIT = readPositiveInt('CHAT_RATE_LIMIT_CONVERSATION_BURST', 6);
const GLOBAL_BURST_WINDOW_MS = readPositiveInt('CHAT_RATE_LIMIT_GLOBAL_WINDOW_MS', 60_000);
const GLOBAL_BURST_LIMIT = readPositiveInt('CHAT_RATE_LIMIT_GLOBAL_BURST', 20);
const DUPLICATE_WINDOW_MS = readPositiveInt('CHAT_RATE_LIMIT_DUPLICATE_WINDOW_MS', 120_000);
const DUPLICATE_LIMIT = readPositiveInt('CHAT_RATE_LIMIT_DUPLICATE_BURST', 3);
const FLAG_DEDUPE_WINDOW_MS = readPositiveInt('CHAT_SAFETY_FLAG_DEDUPE_WINDOW_MS', 6 * 60 * 60 * 1000);
const REPORT_WINDOW_MS = readPositiveInt('CHAT_SAFETY_REPORT_WINDOW_MS', 24 * 60 * 60 * 1000);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clampText(value, max = 400) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function textFingerprint(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function buildMessageFingerprint(input = {}) {
  const type = String(input?.type || 'text').trim().toLowerCase();
  const mediaKind = String(input?.media?.mediaKind || input?.mediaKind || type).trim().toLowerCase();
  if (type === 'text') {
    const fp = textFingerprint(input?.text || '');
    return fp ? `text:${fp}` : null;
  }
  if (['image', 'video', 'file', 'voice', 'video_note'].includes(type)) {
    const fp = textFingerprint(input?.text || '');
    return `media:${mediaKind}:${fp || 'no-caption'}`;
  }
  return null;
}

function reportReasonFamily(reason) {
  const text = String(reason || '').trim().toLowerCase();
  if (!text) return '';
  if (/спам|spam|флуд|flood/.test(text)) return 'spam';
  if (/мошенн|скам|scam|fraud|phish/.test(text)) return 'scam';
  if (/оскорб|harass|травл|bully|abuse/.test(text)) return 'harassment';
  if (/угроз|threat|насили/.test(text)) return 'threat';
  if (/сексу|sexual|nsfw/.test(text)) return 'sexual';
  return 'other';
}

export async function recordMessengerSafetyFlag(input = {}, db = prisma) {
  if (!db?.messengerSafetyFlag) return null;

  const dedupeKey = clampText(input?.dedupeKey, 191);
  const status = clampText(input?.status, 40) || 'open';
  const reason = clampText(input?.reason, 160) || 'unspecified';
  const category = clampText(input?.category, 60) || 'messenger';
  const severity = clampText(input?.severity, 20) || 'medium';
  const actorUserId = Number.isInteger(Number(input?.actorUserId)) ? Number(input.actorUserId) : null;
  const targetUserId = Number.isInteger(Number(input?.targetUserId)) ? Number(input.targetUserId) : null;
  const conversationId = clampText(input?.conversationId, 191);
  const messageId = clampText(input?.messageId, 191);
  const details = asObject(input?.details);

  if (dedupeKey) {
    const existing = await db.messengerSafetyFlag.findFirst({
      where: {
        dedupeKey,
        status: { in: ['open', 'reviewed'] },
        updatedAt: { gte: new Date(Date.now() - FLAG_DEDUPE_WINDOW_MS) },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (existing) {
      return db.messengerSafetyFlag.update({
        where: { id: existing.id },
        data: {
          status,
          severity,
          reason,
          actorUserId,
          targetUserId,
          conversationId,
          messageId,
          details: { ...(asObject(existing.details)), ...details },
          occurrenceCount: { increment: 1 },
          lastTriggeredAt: new Date(),
        },
      });
    }
  }

  return db.messengerSafetyFlag.create({
    data: {
      category,
      reason,
      severity,
      status,
      dedupeKey,
      actorUserId,
      targetUserId,
      conversationId,
      messageId,
      details: Object.keys(details).length ? details : null,
      lastTriggeredAt: new Date(),
    },
  });
}

export async function enforceMessageAntiSpam(userId, conversation, input = {}, db = prisma) {
  if (!db?.chatMessage) return;
  const senderId = Number(userId);
  const conversationId = String(conversation?.id || '');
  if (!senderId || !conversationId) return;

  const now = Date.now();
  const conversationCutoff = new Date(now - CONVERSATION_BURST_WINDOW_MS);
  const globalCutoff = new Date(now - GLOBAL_BURST_WINDOW_MS);
  const duplicateCutoff = new Date(now - DUPLICATE_WINDOW_MS);
  const fingerprint = buildMessageFingerprint(input);

  const [conversationBurst, globalBurst, recentOwnMessages] = await Promise.all([
    db.chatMessage.count({
      where: {
        senderId,
        conversationId,
        deletedAt: null,
        createdAt: { gte: conversationCutoff },
      },
    }),
    db.chatMessage.count({
      where: {
        senderId,
        deletedAt: null,
        createdAt: { gte: globalCutoff },
      },
    }),
    fingerprint
      ? db.chatMessage.findMany({
          where: {
            senderId,
            deletedAt: null,
            createdAt: { gte: duplicateCutoff },
          },
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: { id: true, text: true, type: true, mediaKind: true, createdAt: true },
        })
      : Promise.resolve([]),
  ]);

  if (conversationBurst >= CONVERSATION_BURST_LIMIT) {
    await recordMessengerSafetyFlag({
      category: 'anti_spam',
      reason: 'conversation_burst_limit',
      severity: 'medium',
      dedupeKey: `conv-burst:${senderId}:${conversationId}:${Math.floor(now / 60000)}`,
      actorUserId: senderId,
      targetUserId: senderId,
      conversationId,
      details: { threshold: CONVERSATION_BURST_LIMIT, windowMs: CONVERSATION_BURST_WINDOW_MS, count: conversationBurst },
    }, db);
    throw Object.assign(new Error('Слишком частая отправка в этот чат. Сделай короткую паузу и попробуй ещё раз.'), { status: 429 });
  }

  if (globalBurst >= GLOBAL_BURST_LIMIT) {
    await recordMessengerSafetyFlag({
      category: 'anti_spam',
      reason: 'global_burst_limit',
      severity: 'high',
      dedupeKey: `global-burst:${senderId}:${Math.floor(now / 300000)}`,
      actorUserId: senderId,
      targetUserId: senderId,
      conversationId,
      details: { threshold: GLOBAL_BURST_LIMIT, windowMs: GLOBAL_BURST_WINDOW_MS, count: globalBurst },
    }, db);
    throw Object.assign(new Error('Слишком много сообщений за короткое время. Подожди немного и попробуй снова.'), { status: 429 });
  }

  if (fingerprint) {
    const duplicateCount = recentOwnMessages.filter((item) => buildMessageFingerprint(item) === fingerprint).length;
    if (duplicateCount >= DUPLICATE_LIMIT) {
      await recordMessengerSafetyFlag({
        category: 'anti_spam',
        reason: 'duplicate_message_pattern',
        severity: 'medium',
        dedupeKey: `dup:${senderId}:${conversationId}:${fingerprint}`,
        actorUserId: senderId,
        targetUserId: senderId,
        conversationId,
        details: { fingerprint, windowMs: DUPLICATE_WINDOW_MS, count: duplicateCount },
      }, db);
      throw Object.assign(new Error('Похожие сообщения отправляются слишком часто. Чтобы защитить чат от спама, повтор сейчас ограничен.'), { status: 429 });
    }
  }
}

export async function evaluateReportedMessageSafety(message, report, db = prisma) {
  if (!db?.chatMessageReport || !db?.messengerSafetyFlag || !message?.senderId) return { flag: null };

  const family = reportReasonFamily(report?.reason);
  if (!family) return { flag: null };

  const cutoff = new Date(Date.now() - REPORT_WINDOW_MS);
  const [reportsAgainstSender24h, familyReports24h] = await Promise.all([
    db.chatMessageReport.count({
      where: {
        createdAt: { gte: cutoff },
        message: { senderId: Number(message.senderId) },
      },
    }),
    family === 'other' ? Promise.resolve(0) : db.chatMessageReport.findMany({
      where: {
        createdAt: { gte: cutoff },
        message: { senderId: Number(message.senderId) },
      },
      select: { reason: true },
      take: 30,
    }).then((rows) => rows.filter((row) => reportReasonFamily(row.reason) === family).length),
  ]);

  const thresholdReached = reportsAgainstSender24h >= 3 || familyReports24h >= 2;
  if (!thresholdReached) return { flag: null };

  const severity = ['threat', 'sexual'].includes(family) || reportsAgainstSender24h >= 5 ? 'high' : 'medium';
  const flag = await recordMessengerSafetyFlag({
    category: 'report_threshold',
    reason: `${family}_report_threshold`,
    severity,
    dedupeKey: `report-threshold:${message.senderId}:${family}`,
    actorUserId: Number(report.reporterUserId),
    targetUserId: Number(message.senderId),
    conversationId: message.conversationId || null,
    messageId: message.id || null,
    details: { reportReason: report.reason, reportsAgainstSender24h, familyReports24h },
  }, db);
  return { flag };
}

export async function upsertPeerSafetyBlock(blockerUserId, message, input = {}, db = prisma) {
  if (!db?.messengerPeerBlock || !message?.conversationId || !message?.senderId) return { blocked: false, record: null };

  const blockerId = Number(blockerUserId);
  const blockedId = Number(message.senderId);
  if (!blockerId || !blockedId || blockerId === blockedId) return { blocked: false, record: null };
  if (String(message?.conversation?.type || '') !== 'direct') return { blocked: false, record: null };

  const reason = clampText(input?.reason, 120) || 'safety_report';
  const details = clampText(input?.details, 500);

  const record = await db.messengerPeerBlock.upsert({
    where: {
      blockerUserId_blockedUserId_conversationId: {
        blockerUserId: blockerId,
        blockedUserId: blockedId,
        conversationId: String(message.conversationId),
      },
    },
    update: { reason, details },
    create: {
      blockerUserId: blockerId,
      blockedUserId: blockedId,
      conversationId: String(message.conversationId),
      reason,
      details,
    },
  });

  emitUsersEvent([blockerId, blockedId], 'message_request.updated', {
    conversationId: String(message.conversationId),
    request: {
      id: `peer-block:${record.id}`,
      status: 'blocked',
      fromUserId: blockedId,
      toUserId: blockerId,
      updatedAt: record.updatedAt,
    },
  });
  await emitUnreadSummary([blockerId, blockedId], db).catch(() => null);
  return { blocked: true, record };
}

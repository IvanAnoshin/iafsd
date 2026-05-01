import prisma from '@/lib/prisma';
import { emitUsersEvent } from '@/lib/chat-realtime';
import { createNotification } from '@/lib/notifications';

function hasCallModels(db = prisma) {
  return Boolean(db?.callSession && db?.callParticipant && db?.callEvent && db?.conversation && db?.conversationMember);
}

function initialsOf(firstName, lastName) {
  return `${String(firstName || '').trim().charAt(0)}${String(lastName || '').trim().charAt(0)}`.toUpperCase() || 'U';
}

function jsonSafe(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function isActiveStatus(status) {
  return status === 'ringing' || status === 'active';
}

function isEndedStatus(status) {
  return ['ended', 'cancelled', 'rejected', 'busy', 'missed', 'declined', 'failed'].includes(String(status || ''));
}

const CALL_RINGING_TIMEOUT_MS = Math.max(Number(process.env.CHAT_CALL_RINGING_TIMEOUT_MS || 45000), 15000);

function isRingingTimeoutExceeded(call, now = Date.now()) {
  if (!call || String(call.status || '') !== 'ringing' || call.acceptedAt) return false;
  const createdAt = new Date(call.createdAt || 0).getTime();
  if (!createdAt) return false;
  return now - createdAt >= CALL_RINGING_TIMEOUT_MS;
}

const callInclude = {
  conversation: {
    include: {
      members: {
        include: {
          user: { include: { publicProfile: true } },
        },
      },
      messageRequest: true,
    },
  },
  initiator: {
    include: { publicProfile: true },
  },
  participants: {
    include: {
      user: { include: { publicProfile: true } },
    },
    orderBy: { userId: 'asc' },
  },
  events: {
    orderBy: { createdAt: 'desc' },
    take: 30,
  },
};

async function getConversationForUser(userId, conversationId, db = prisma) {
  return db.conversation.findFirst({
    where: { id: String(conversationId), members: { some: { userId: Number(userId) } } },
    include: {
      members: {
        include: {
          user: { include: { publicProfile: true } },
        },
      },
      messageRequest: true,
    },
  });
}

function serializeParticipant(participant, viewerId) {
  const user = participant?.user;
  const name = user ? `${user.firstName} ${user.lastName}`.trim() : 'Участник';
  return {
    id: participant.id,
    user_id: participant.userId,
    name,
    initials: initialsOf(user?.firstName, user?.lastName),
    handle: user?.publicProfile?.handle ? `@${user.publicProfile.handle}` : null,
    state: participant.state,
    role: participant.role,
    joined_at: participant.joinedAt,
    left_at: participant.leftAt,
    is_mic_on: participant.isMicOn,
    is_camera_on: participant.isCameraOn,
    is_me: Number(participant.userId) === Number(viewerId),
  };
}

function computeViewerFlags(call, viewerId) {
  const me = call?.participants?.find((item) => Number(item.userId) === Number(viewerId)) || null;
  const isInitiator = Number(call?.initiatorId) === Number(viewerId);
  const status = String(call?.status || '');
  return {
    me,
    isInitiator,
    can_accept: Boolean(me && !isInitiator && status === 'ringing' && !['joined', 'rejected', 'busy', 'left'].includes(String(me.state || ''))),
    can_reject: Boolean(me && !isInitiator && status === 'ringing' && !['joined', 'rejected', 'busy', 'left'].includes(String(me.state || ''))),
    can_busy: Boolean(me && !isInitiator && status === 'ringing' && !['joined', 'rejected', 'busy', 'left'].includes(String(me.state || ''))),
    can_cancel: Boolean(isInitiator && status === 'ringing'),
    can_end: Boolean(me && (status === 'active' || (status === 'ringing' && isInitiator))),
    can_toggle: Boolean(me && status === 'active'),
  };
}

function serializeCallSession(call, viewerId) {
  const viewer = computeViewerFlags(call, viewerId);
  const ringingDeadline = String(call?.status || '') === 'ringing' && call?.createdAt
    ? new Date(new Date(call.createdAt).getTime() + CALL_RINGING_TIMEOUT_MS)
    : null;
  const initiatorName = call?.initiator ? `${call.initiator.firstName} ${call.initiator.lastName}`.trim() : 'Пользователь';
  const participantItems = Array.isArray(call?.participants) ? call.participants.map((item) => serializeParticipant(item, viewerId)) : [];
  const others = participantItems.filter((item) => !item.is_me);
  const peerNames = others.map((item) => item.name).filter(Boolean);
  return {
    id: call.id,
    conversation_id: call.conversationId,
    type: call.type,
    status: call.status,
    started_at: call.startedAt,
    accepted_at: call.acceptedAt,
    ended_at: call.endedAt,
    ended_reason: call.endedReason,
    created_at: call.createdAt,
    updated_at: call.updatedAt,
    ringing_deadline: ringingDeadline,
    initiator: {
      id: call.initiatorId,
      name: initiatorName,
      initials: initialsOf(call?.initiator?.firstName, call?.initiator?.lastName),
      handle: call?.initiator?.publicProfile?.handle ? `@${call.initiator.publicProfile.handle}` : null,
      is_me: Number(call.initiatorId) === Number(viewerId),
    },
    participants: participantItems,
    participant_count: participantItems.length,
    peer_names: peerNames,
    request_state: call?.conversation?.messageRequest?.status === 'pending'
      ? (Number(call.conversation.messageRequest.fromUserId) === Number(viewerId) ? 'outgoing' : 'incoming')
      : null,
    viewer: {
      participant_id: viewer.me?.id || null,
      state: viewer.me?.state || null,
      is_initiator: viewer.isInitiator,
      can_accept: viewer.can_accept,
      can_reject: viewer.can_reject,
      can_busy: viewer.can_busy,
      can_cancel: viewer.can_cancel,
      can_end: viewer.can_end,
      can_toggle: viewer.can_toggle,
      is_mic_on: viewer.me?.isMicOn ?? true,
      is_camera_on: viewer.me?.isCameraOn ?? true,
    },
    last_event: call?.events?.[0]
      ? {
          id: call.events[0].id,
          event_type: call.events[0].eventType,
          actor_user_id: call.events[0].actorUserId,
          payload: call.events[0].payload || null,
          created_at: call.events[0].createdAt,
        }
      : null,
  };
}

async function createMissedNotificationsForUsers(call, recipientIds = [], db = prisma) {
  const uniqueIds = [...new Set((recipientIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  for (const userId of uniqueIds) {
    await createNotification({
      userId,
      actorUserId: call?.initiatorId || null,
      type: 'missed_call',
      title: 'Пропущенный звонок',
      body: call?.type === 'video' ? 'Вы пропустили видеозвонок.' : 'Вы пропустили аудиозвонок.',
      entityType: 'call_session',
      entityId: call?.id || null,
      targetLabel: 'Мессенджер',
      payload: { callId: call?.id || null, conversationId: call?.conversationId || null, type: call?.type || 'audio' },
    }, db);
  }
}

async function reconcileCallSessionState(callId, db = prisma) {
  if (!callId) return null;
  const existing = await db.callSession.findUnique({ where: { id: String(callId) }, include: callInclude });
  if (!existing) return null;
  if (!isRingingTimeoutExceeded(existing)) return existing;

  const now = new Date();
  const updated = await db.$transaction(async (tx) => {
    const latest = await tx.callSession.findUnique({ where: { id: String(callId) }, include: callInclude });
    if (!latest || !isRingingTimeoutExceeded(latest)) return latest;
    const missedRecipientIds = (latest.participants || [])
      .filter((participant) => Number(participant.userId) !== Number(latest.initiatorId) && String(participant.state || '') === 'ringing')
      .map((participant) => participant.userId);
    await tx.callParticipant.updateMany({
      where: { callSessionId: latest.id, state: 'ringing' },
      data: { state: 'missed', leftAt: now },
    });
    await tx.callSession.update({
      where: { id: latest.id },
      data: { status: 'missed', endedAt: now, endedReason: 'timeout' },
    });
    await createCallEvent(tx, latest.id, null, 'timeout', { endedAt: now.toISOString(), reason: 'ringing_timeout' });
    const refreshed = await tx.callSession.findUnique({ where: { id: latest.id }, include: callInclude });
    refreshed._missedRecipientIds = missedRecipientIds;
    return refreshed;
  });

  if (!updated) return null;
  const participantIds = (updated.conversation?.members || []).map((member) => member.userId);
  const missedRecipientIds = Array.isArray(updated._missedRecipientIds) ? updated._missedRecipientIds : [];
  if (missedRecipientIds.length) {
    await createMissedNotificationsForUsers(updated, missedRecipientIds, db);
  }
  if (participantIds.length) {
    await emitCallState(updated.id, participantIds, db);
  }
  return updated;
}

async function reconcileConversationCalls(conversationId, db = prisma) {
  if (!conversationId) return;
  const ringingCalls = await db.callSession.findMany({
    where: { conversationId: String(conversationId), status: 'ringing' },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
    take: 12,
  });
  for (const item of ringingCalls) {
    // eslint-disable-next-line no-await-in-loop
    await reconcileCallSessionState(item.id, db);
  }
}

async function fetchCallForViewer(callId, viewerId, db = prisma) {
  const reconciled = await reconcileCallSessionState(callId, db);
  const call = reconciled && (reconciled.conversation?.members || []).some((member) => Number(member.userId) === Number(viewerId))
    ? reconciled
    : await db.callSession.findFirst({
    where: {
      id: String(callId),
      conversation: { members: { some: { userId: Number(viewerId) } } },
    },
    include: callInclude,
  });
  return call || null;
}

async function emitCallState(callId, userIds, db = prisma) {
  const uniqueIds = [...new Set((userIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  if (!uniqueIds.length) return null;
  const call = await db.callSession.findUnique({ where: { id: String(callId) }, include: callInclude });
  if (!call) return null;
  uniqueIds.forEach((userId) => {
    emitUsersEvent([userId], 'call.updated', { conversationId: call.conversationId, call: serializeCallSession(call, userId) });
  });
  return call;
}

async function createCallEvent(db, callSessionId, actorUserId, eventType, payload = null) {
  return db.callEvent.create({
    data: {
      callSessionId: String(callSessionId),
      actorUserId: actorUserId == null ? null : Number(actorUserId),
      eventType: String(eventType),
      payload: jsonSafe(payload),
    },
  });
}

export async function listCallsForConversation(viewerId, conversationId, options = {}, db = prisma) {
  if (!hasCallModels(db)) throw Object.assign(new Error('Звонки пока не доступны.'), { status: 503 });
  await reconcileConversationCalls(conversationId, db);
  const conversation = await getConversationForUser(viewerId, conversationId, db);
  if (!conversation) throw Object.assign(new Error('Диалог не найден.'), { status: 404 });
  const take = Math.min(Math.max(Number(options.limit) || 10, 1), 30);
  const items = await db.callSession.findMany({
    where: { conversationId: String(conversationId) },
    orderBy: { createdAt: 'desc' },
    take,
    include: callInclude,
  });
  const serialized = items.map((item) => serializeCallSession(item, viewerId));
  return {
    items: serialized,
    active: serialized.find((item) => isActiveStatus(item.status)) || null,
  };
}

export async function getCallSession(viewerId, callId, db = prisma) {
  if (!hasCallModels(db)) throw Object.assign(new Error('Звонки пока не доступны.'), { status: 503 });
  const call = await fetchCallForViewer(callId, viewerId, db);
  if (!call) throw Object.assign(new Error('Сеанс звонка не найден.'), { status: 404 });
  return serializeCallSession(call, viewerId);
}

export async function createCallSession(viewerId, conversationId, options = {}, db = prisma) {
  if (!hasCallModels(db)) throw Object.assign(new Error('Звонки пока не доступны.'), { status: 503 });
  const viewer = Number(viewerId);
  const type = String(options?.type || 'audio') === 'video' ? 'video' : 'audio';
  await reconcileConversationCalls(conversationId, db);
  const conversation = await getConversationForUser(viewer, conversationId, db);
  if (!conversation) throw Object.assign(new Error('Диалог не найден.'), { status: 404 });
  if (db?.messengerPeerBlock && String(conversation?.type || '') === 'direct') {
    const peerId = conversation.members.find((member) => Number(member.userId) !== viewer)?.userId || null;
    if (peerId) {
      const peerBlock = await db.messengerPeerBlock.findFirst({
        where: {
          blockerUserId: Number(peerId),
          blockedUserId: viewer,
          conversationId: String(conversationId),
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (peerBlock) {
        throw Object.assign(new Error('Пользователь ограничил входящие сообщения и звонки в этом диалоге.'), { status: 403 });
      }
    }
  }
  // В режиме активной отладки не блокируем звонок из-за pending request.
  if (!conversation.members || conversation.members.length < 2) {
    throw Object.assign(new Error('Для звонка нужен хотя бы один собеседник.'), { status: 400 });
  }

  const existing = await db.callSession.findFirst({
    where: { conversationId: String(conversationId), status: { in: ['ringing', 'active'] } },
    include: callInclude,
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    return serializeCallSession(existing, viewer);
  }

  const now = new Date();
  const created = await db.$transaction(async (tx) => {
    const call = await tx.callSession.create({
      data: {
        conversationId: String(conversationId),
        initiatorId: viewer,
        type,
        status: 'ringing',
      },
    });
    await tx.callParticipant.createMany({
      data: conversation.members.map((member) => ({
        callSessionId: call.id,
        userId: member.userId,
        role: member.userId === viewer ? 'initiator' : 'participant',
        state: member.userId === viewer ? 'joined' : 'ringing',
        joinedAt: member.userId === viewer ? now : null,
        isMicOn: true,
        isCameraOn: type === 'video',
      })),
    });
    await createCallEvent(tx, call.id, viewer, 'invite', { type });
    return tx.callSession.findUnique({ where: { id: call.id }, include: callInclude });
  });

  const recipientIds = conversation.members.map((member) => member.userId).filter((id) => id !== viewer);
  for (const userId of recipientIds) {
    await createNotification({
      userId,
      actorUserId: viewer,
      type: 'call_invite',
      title: type === 'video' ? 'Видеозвонок' : 'Аудиозвонок',
      body: type === 'video' ? 'Вам звонят в видеоформате.' : 'Вам звонят в аудиоформате.',
      entityType: 'call_session',
      entityId: created.id,
      targetLabel: 'Мессенджер',
      payload: { conversationId: String(conversationId), callId: created.id, type },
    }, db);
  }

  recipientIds.forEach((userId) => {
    emitUsersEvent([userId], 'call.invite', {
      conversationId: String(conversationId),
      call: serializeCallSession(created, userId),
    });
  });
  await emitCallState(created.id, conversation.members.map((member) => member.userId), db);
  return serializeCallSession(created, viewer);
}

function shouldFinalizeAfterResponse(call) {
  const others = call.participants.filter((participant) => Number(participant.userId) !== Number(call.initiatorId));
  if (!others.length) return true;
  return others.every((participant) => ['rejected', 'busy', 'left', 'missed'].includes(String(participant.state || '')));
}

async function createMissedNotifications(call, actorUserId, db = prisma) {
  const pendingRecipients = (call.participants || []).filter((participant) => {
    if (Number(participant.userId) === Number(actorUserId)) return false;
    return ['ringing'].includes(String(participant.state || ''));
  });
  for (const participant of pendingRecipients) {
    await createNotification({
      userId: participant.userId,
      actorUserId,
      type: 'missed_call',
      title: 'Пропущенный звонок',
      body: call.type === 'video' ? 'Вы пропустили видеозвонок.' : 'Вы пропустили аудиозвонок.',
      entityType: 'call_session',
      entityId: call.id,
      targetLabel: 'Мессенджер',
      payload: { callId: call.id, conversationId: call.conversationId, type: call.type },
    }, db);
  }
}

export async function applyCallAction(viewerId, callId, action, payload = {}, db = prisma) {
  if (!hasCallModels(db)) throw Object.assign(new Error('Звонки пока не доступны.'), { status: 503 });
  const viewer = Number(viewerId);
  const normalizedAction = String(action || '').toLowerCase();
  const call = await fetchCallForViewer(callId, viewer, db);
  if (!call) throw Object.assign(new Error('Сеанс звонка не найден.'), { status: 404 });
  if (isEndedStatus(call.status) && normalizedAction !== 'toggle') {
    throw Object.assign(new Error('Звонок уже завершён.'), { status: 409 });
  }
  const participant = call.participants.find((item) => Number(item.userId) === viewer) || null;
  if (!participant) throw Object.assign(new Error('Нет доступа к звонку.'), { status: 403 });

  const updated = await db.$transaction(async (tx) => {
    const now = new Date();
    if (normalizedAction === 'accept') {
      if (call.status !== 'ringing') throw Object.assign(new Error('Этот звонок уже нельзя принять.'), { status: 409 });
      await tx.callParticipant.update({
        where: { callSessionId_userId: { callSessionId: call.id, userId: viewer } },
        data: { state: 'joined', joinedAt: participant.joinedAt || now, leftAt: null },
      });
      await tx.callSession.update({
        where: { id: call.id },
        data: {
          status: 'active',
          acceptedAt: call.acceptedAt || now,
          startedAt: call.startedAt || now,
        },
      });
      await createCallEvent(tx, call.id, viewer, 'accept', { acceptedAt: now.toISOString() });
      return tx.callSession.findUnique({ where: { id: call.id }, include: callInclude });
    }

    if (normalizedAction === 'reject') {
      if (call.status !== 'ringing') throw Object.assign(new Error('Этот звонок уже нельзя отклонить.'), { status: 409 });
      await tx.callParticipant.update({
        where: { callSessionId_userId: { callSessionId: call.id, userId: viewer } },
        data: { state: 'rejected', leftAt: now },
      });
      await createCallEvent(tx, call.id, viewer, 'reject', null);
      const refreshed = await tx.callSession.findUnique({ where: { id: call.id }, include: callInclude });
      if (shouldFinalizeAfterResponse(refreshed)) {
        await tx.callSession.update({ where: { id: call.id }, data: { status: 'rejected', endedAt: now, endedReason: 'rejected' } });
        return tx.callSession.findUnique({ where: { id: call.id }, include: callInclude });
      }
      return refreshed;
    }

    if (normalizedAction === 'busy') {
      if (call.status !== 'ringing') throw Object.assign(new Error('Этот звонок уже нельзя пометить занятым.'), { status: 409 });
      await tx.callParticipant.update({
        where: { callSessionId_userId: { callSessionId: call.id, userId: viewer } },
        data: { state: 'busy', leftAt: now },
      });
      await createCallEvent(tx, call.id, viewer, 'busy', null);
      const refreshed = await tx.callSession.findUnique({ where: { id: call.id }, include: callInclude });
      if (shouldFinalizeAfterResponse(refreshed)) {
        await tx.callSession.update({ where: { id: call.id }, data: { status: 'busy', endedAt: now, endedReason: 'busy' } });
        return tx.callSession.findUnique({ where: { id: call.id }, include: callInclude });
      }
      return refreshed;
    }

    if (normalizedAction === 'cancel') {
      if (Number(call.initiatorId) !== viewer) throw Object.assign(new Error('Только инициатор может отменить звонок.'), { status: 403 });
      if (call.status !== 'ringing') throw Object.assign(new Error('Этот звонок уже нельзя отменить.'), { status: 409 });
      await tx.callParticipant.updateMany({ where: { callSessionId: call.id, leftAt: null }, data: { leftAt: now } });
      await tx.callSession.update({ where: { id: call.id }, data: { status: 'cancelled', endedAt: now, endedReason: 'cancelled' } });
      await createCallEvent(tx, call.id, viewer, 'cancel', null);
      return tx.callSession.findUnique({ where: { id: call.id }, include: callInclude });
    }

    if (normalizedAction === 'end') {
      if (!['active', 'ringing'].includes(call.status)) throw Object.assign(new Error('Этот звонок уже завершён.'), { status: 409 });
      await tx.callParticipant.updateMany({ where: { callSessionId: call.id, leftAt: null }, data: { leftAt: now } });
      await tx.callSession.update({ where: { id: call.id }, data: { status: 'ended', endedAt: now, endedReason: 'ended' } });
      await createCallEvent(tx, call.id, viewer, 'end', null);
      return tx.callSession.findUnique({ where: { id: call.id }, include: callInclude });
    }

    if (normalizedAction === 'toggle') {
      const data = {};
      if (typeof payload?.isMicOn === 'boolean') data.isMicOn = payload.isMicOn;
      if (typeof payload?.isCameraOn === 'boolean') data.isCameraOn = payload.isCameraOn;
      if (!Object.keys(data).length) throw Object.assign(new Error('Нет изменений для участника звонка.'), { status: 400 });
      await tx.callParticipant.update({
        where: { callSessionId_userId: { callSessionId: call.id, userId: viewer } },
        data,
      });
      await createCallEvent(tx, call.id, viewer, 'toggle', data);
      return tx.callSession.findUnique({ where: { id: call.id }, include: callInclude });
    }

    throw Object.assign(new Error('Неизвестное действие звонка.'), { status: 400 });
  });

  const participantIds = updated.conversation.members.map((member) => member.userId);
  if (normalizedAction === 'cancel') {
    await createMissedNotifications(updated, viewer, db);
  }
  if (normalizedAction === 'busy') {
    await createNotification({
      userId: updated.initiatorId,
      actorUserId: viewer,
      type: 'call_busy',
      title: 'Собеседник занят',
      body: 'Собеседник не может ответить на звонок сейчас.',
      entityType: 'call_session',
      entityId: updated.id,
      targetLabel: 'Мессенджер',
      payload: { conversationId: updated.conversationId, callId: updated.id },
    }, db);
  }
  await emitCallState(updated.id, participantIds, db);
  return serializeCallSession(updated, viewer);
}

export async function pushCallSignal(viewerId, callId, signalType, payload = {}, db = prisma) {
  if (!hasCallModels(db)) throw Object.assign(new Error('Звонки пока не доступны.'), { status: 503 });
  const viewer = Number(viewerId);
  const normalizedType = String(signalType || '').toLowerCase();
  if (!['offer', 'answer', 'ice'].includes(normalizedType)) {
    throw Object.assign(new Error('Некорректный тип сигнала.'), { status: 400 });
  }
  const call = await fetchCallForViewer(callId, viewer, db);
  if (!call) throw Object.assign(new Error('Сеанс звонка не найден.'), { status: 404 });
  if (!['ringing', 'active'].includes(call.status)) {
    throw Object.assign(new Error('Нельзя отправить сигнал в завершённый звонок.'), { status: 409 });
  }
  const participant = call.participants.find((item) => Number(item.userId) === viewer);
  if (!participant) throw Object.assign(new Error('Нет доступа к звонку.'), { status: 403 });

  await createCallEvent(db, call.id, viewer, `signal:${normalizedType}`, payload);
  const recipients = call.participants.map((item) => item.userId).filter((id) => id !== viewer);
  emitUsersEvent(recipients, 'call.signal', {
    conversationId: call.conversationId,
    callId: call.id,
    signal_type: normalizedType,
    from_user_id: viewer,
    payload: jsonSafe(payload),
  });
  return { ok: true };
}

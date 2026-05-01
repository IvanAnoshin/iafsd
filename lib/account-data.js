import crypto from 'node:crypto';
import prisma from './prisma.js';

const DEFAULT_DELETION_GRACE_DAYS = 14;
const EXPORT_TTL_HOURS = 24;

function nowPlusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

function nowPlusHours(hours) {
  const date = new Date();
  date.setHours(date.getHours() + Number(hours || 0));
  return date;
}

function deletionGraceDays() {
  const raw = Number(process.env.ACCOUNT_DELETION_GRACE_DAYS || DEFAULT_DELETION_GRACE_DAYS);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_DELETION_GRACE_DAYS;
  return Math.min(90, Math.floor(raw));
}

function safeText(value, max = 500) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function toIso(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function stripNulls(value) {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, stripNulls(item)]));
}

function exportProfile(user) {
  const profile = user?.publicProfile || null;
  return stripNulls({
    id: user.id,
    first_name: user.firstName,
    last_name: user.lastName,
    normalized_key: user.normalizedKey,
    account_status: user.accountStatus || 'active',
    created_at: toIso(user.createdAt),
    deactivated_at: toIso(user.deactivatedAt),
    deletion_requested_at: toIso(user.deletionRequestedAt),
    deletion_scheduled_at: toIso(user.deletionScheduledAt),
    public_profile: profile ? {
      handle: profile.handle,
      bio: profile.bio,
      occupation: profile.occupation,
      city: profile.city,
      relationship_status: profile.relationshipStatus,
      tone: profile.tone,
      status: profile.status,
      created_at: toIso(profile.createdAt),
      updated_at: toIso(profile.updatedAt),
    } : null,
  });
}

function exportSecuritySummary(user) {
  return {
    has_recovery_phrase: Boolean(user.recoveryPhraseHash),
    backup_code_count: Array.isArray(user.backupCodeHashes) ? user.backupCodeHashes.length : 0,
    dfsn_configured: Boolean(user.behavioralProfile),
    dfsn_trust_label: user.behavioralTrustLabel || null,
    dfsn_updated_at: toIso(user.behavioralUpdatedAt),
    note: 'Секреты, хэши, DFSN-профиль, passkey public keys и encrypted backup blobs не входят в экспорт.',
  };
}

function messageExport(message) {
  return stripNulls({
    id: message.id,
    conversation_id: message.conversationId,
    type: message.type,
    text: message.isEncrypted ? null : message.text,
    encrypted: Boolean(message.isEncrypted),
    content_hint: message.contentHint || null,
    status: message.status,
    media: message.mediaUrl ? {
      kind: message.mediaKind,
      url: message.mediaUrl,
      thumb_url: message.mediaThumbUrl,
      mime: message.mediaMime,
      bytes: message.mediaBytes,
      duration_sec: message.mediaDurationSec,
      width: message.mediaWidth,
      height: message.mediaHeight,
    } : null,
    created_at: toIso(message.createdAt),
    edited_at: toIso(message.editedAt),
    deleted_at: toIso(message.deletedAt || message.deletedForAllAt),
  });
}

async function countModel(tx, modelName, where) {
  const model = tx?.[modelName];
  if (!model?.count) return 0;
  return model.count({ where }).catch(() => 0);
}

export async function buildUserDataExport(userId, db = prisma) {
  const id = Number(userId);
  const [
    user,
    posts,
    comments,
    memberships,
    ownedCommunities,
    conversations,
    sentMessages,
    savedMessages,
    notifications,
    devices,
    passkeys,
    supportTickets,
    postReports,
    commentReports,
    targetReports,
    moderationRestrictions,
  ] = await Promise.all([
    db.user.findUnique({
      where: { id },
      include: {
        publicProfile: true,
        preference: true,
        feedSettings: true,
        mediaSettings: true,
      },
    }),
    db.post.findMany({ where: { authorId: id }, orderBy: { createdAt: 'desc' }, take: 1000 }),
    db.comment.findMany({ where: { authorId: id }, orderBy: { createdAt: 'desc' }, take: 1000 }),
    db.communityMember.findMany({
      where: { userId: id },
      orderBy: { joinedAt: 'desc' },
      include: { community: { select: { id: true, slug: true, name: true, visibility: true, ownerId: true } } },
      take: 500,
    }),
    db.community.findMany({ where: { ownerId: id }, orderBy: { createdAt: 'desc' }, take: 500 }),
    db.conversationMember.findMany({
      where: { userId: id },
      orderBy: { joinedAt: 'desc' },
      include: { conversation: { select: { id: true, type: true, title: true, createdAt: true, updatedAt: true, lastMessageAt: true } } },
      take: 500,
    }),
    db.chatMessage.findMany({ where: { senderId: id }, orderBy: { createdAt: 'desc' }, take: 2000 }),
    db.savedChatMessage.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 1000, select: { messageId: true, createdAt: true } }),
    db.notification.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 1000 }),
    db.userDevice.findMany({ where: { userId: id }, orderBy: { lastSeenAt: 'desc' }, take: 200 }),
    db.accountPasskey.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 200 }),
    db.supportTicket.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 200 }),
    db.postReport.findMany({ where: { reporterUserId: id }, orderBy: { createdAt: 'desc' }, take: 500 }),
    db.commentReport.findMany({ where: { reporterUserId: id }, orderBy: { createdAt: 'desc' }, take: 500 }),
    db.targetReport.findMany({ where: { reporterUserId: id }, orderBy: { createdAt: 'desc' }, take: 500 }).catch(() => []),
    db.userModerationRestriction.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 200 }).catch(() => []),
  ]);

  if (!user) {
    const error = new Error('Пользователь не найден.');
    error.status = 404;
    throw error;
  }

  const counts = {
    posts: await countModel(db, 'post', { authorId: id }),
    comments: await countModel(db, 'comment', { authorId: id }),
    sent_messages: await countModel(db, 'chatMessage', { senderId: id }),
    communities: await countModel(db, 'communityMember', { userId: id }),
    notifications: await countModel(db, 'notification', { userId: id }),
  };

  return {
    export_version: 1,
    generated_at: new Date().toISOString(),
    policy: {
      email_phone: 'Friendscape не строит идентификацию на email и телефоне.',
      scope: 'Экспорт включает данные аккаунта и пользовательский контент, доступный самому пользователю.',
      excluded: [
        'passwordHash',
        'secretAnswerHash',
        'backupCodeHashes',
        'recoveryPhraseHash',
        'DFSN raw profile and signal weights',
        'passkey public keys',
        'encrypted E2EE backup blobs',
        'private content of other users',
      ],
    },
    counts,
    profile: exportProfile(user),
    settings: stripNulls({
      preferences: user.preference || null,
      feed: user.feedSettings || null,
      media: user.mediaSettings || null,
    }),
    security_summary: exportSecuritySummary(user),
    content: {
      posts: posts.map((post) => stripNulls({
        id: post.id,
        text: post.text,
        type: post.type,
        visibility: post.visibility,
        status: post.status,
        community_id: post.communityId,
        payload: post.payload || null,
        location: post.location,
        created_at: toIso(post.createdAt),
        updated_at: toIso(post.updatedAt),
        deleted_at: toIso(post.deletedAt),
        hidden_at: toIso(post.hiddenAt),
      })),
      comments: comments.map((comment) => stripNulls({
        id: comment.id,
        post_id: comment.postId,
        text: comment.text,
        status: comment.status,
        reply_to_comment_id: comment.replyToCommentId,
        created_at: toIso(comment.createdAt),
        updated_at: toIso(comment.updatedAt),
        deleted_at: toIso(comment.deletedAt),
      })),
      sent_messages: sentMessages.map(messageExport),
      saved_messages: savedMessages.map((item) => ({ message_id: item.messageId, saved_at: toIso(item.createdAt) })),
    },
    communities: {
      memberships: memberships.map((item) => stripNulls({
        community: item.community,
        role: item.role,
        status: item.status,
        joined_at: toIso(item.joinedAt),
      })),
      owned: ownedCommunities.map((community) => stripNulls({
        id: community.id,
        slug: community.slug,
        name: community.name,
        visibility: community.visibility,
        member_count: community.memberCount,
        created_at: toIso(community.createdAt),
      })),
    },
    chats: {
      conversations: conversations.map((item) => stripNulls({
        conversation: item.conversation,
        role: item.role,
        joined_at: toIso(item.joinedAt),
        notifications_mode: item.notificationsMode,
        muted: item.muted,
        pinned: item.pinned,
      })),
    },
    notifications: notifications.map((item) => stripNulls({
      id: item.id,
      type: item.type,
      title: item.title,
      body: item.body,
      entity_type: item.entityType,
      entity_id: item.entityId,
      is_read: item.isRead,
      created_at: toIso(item.createdAt),
      read_at: toIso(item.readAt),
    })),
    security_metadata: {
      devices: devices.map((item) => stripNulls({
        id: item.id,
        label: item.label,
        platform: item.platform,
        trusted: item.trusted,
        last_seen_at: toIso(item.lastSeenAt),
        created_at: toIso(item.createdAt),
      })),
      passkeys: passkeys.map((item) => stripNulls({
        id: item.id,
        label: item.label,
        disabled_at: toIso(item.disabledAt),
        last_used_at: toIso(item.lastUsedAt),
        created_at: toIso(item.createdAt),
      })),
    },
    support_and_reports: {
      support_tickets: supportTickets.map((item) => stripNulls({ id: item.id, category: item.category, subject: item.subject, message: item.message, status: item.status, created_at: toIso(item.createdAt), updated_at: toIso(item.updatedAt) })),
      post_reports: postReports.map((item) => stripNulls({ id: item.id, post_id: item.postId, reason: item.reason, details: item.details, status: item.status, created_at: toIso(item.createdAt) })),
      comment_reports: commentReports.map((item) => stripNulls({ id: item.id, comment_id: item.commentId, reason: item.reason, details: item.details, status: item.status, created_at: toIso(item.createdAt) })),
      target_reports: targetReports.map((item) => stripNulls({ id: item.id, target_type: item.targetType, target_id: item.targetId, reason: item.reason, details: item.details, status: item.status, created_at: toIso(item.createdAt) })),
      moderation_restrictions: moderationRestrictions.map((item) => stripNulls({ id: item.id, type: item.type, surface: item.surface, status: item.status, reason: item.reason, expires_at: toIso(item.expiresAt), lifted_at: toIso(item.liftedAt), created_at: toIso(item.createdAt) })),
    },
  };
}

export async function createDataExportRecord(userId, exportPayload, db = prisma) {
  return db.userDataExport.create({
    data: {
      userId: Number(userId),
      status: 'completed',
      format: 'json',
      completedAt: new Date(),
      expiresAt: nowPlusHours(EXPORT_TTL_HOURS),
      metadata: {
        exportVersion: exportPayload.export_version,
        generatedAt: exportPayload.generated_at,
        counts: exportPayload.counts,
      },
    },
  });
}

export function serializeDeletionRequest(request) {
  if (!request) return null;
  return stripNulls({
    id: request.id,
    status: request.status,
    reason: request.reason,
    requested_at: toIso(request.requestedAt),
    scheduled_for: toIso(request.scheduledFor),
    cancelled_at: toIso(request.cancelledAt),
    completed_at: toIso(request.completedAt),
  });
}

export async function getAccountDeletionStatus(userId, db = prisma) {
  const [user, latestRequest] = await Promise.all([
    db.user.findUnique({
      where: { id: Number(userId) },
      select: {
        id: true,
        accountStatus: true,
        deactivatedAt: true,
        deletionRequestedAt: true,
        deletionScheduledAt: true,
        deletedAt: true,
      },
    }),
    db.accountDeletionRequest.findFirst({ where: { userId: Number(userId) }, orderBy: { requestedAt: 'desc' } }).catch(() => null),
  ]);

  if (!user) return null;
  return {
    account_status: user.accountStatus || 'active',
    deactivated_at: toIso(user.deactivatedAt),
    deletion_requested_at: toIso(user.deletionRequestedAt),
    deletion_scheduled_at: toIso(user.deletionScheduledAt),
    deleted_at: toIso(user.deletedAt),
    deletion_request: serializeDeletionRequest(latestRequest),
    grace_days: deletionGraceDays(),
  };
}

export async function requestAccountDeletion(userId, { reason = null } = {}, db = prisma) {
  const scheduledFor = nowPlusDays(deletionGraceDays());
  return db.$transaction(async (tx) => {
    const existing = await tx.accountDeletionRequest.findFirst({
      where: { userId: Number(userId), status: 'pending' },
      orderBy: { requestedAt: 'desc' },
    });
    if (existing) return existing;

    const request = await tx.accountDeletionRequest.create({
      data: {
        userId: Number(userId),
        status: 'pending',
        reason: safeText(reason, 300),
        scheduledFor,
      },
    });

    await tx.user.update({
      where: { id: Number(userId) },
      data: {
        accountStatus: 'pending_deletion',
        deletionRequestedAt: request.requestedAt,
        deletionScheduledAt: scheduledFor,
        deletionReason: request.reason,
      },
    });

    await tx.notification.create({
      data: {
        userId: Number(userId),
        type: 'account.deletion.requested',
        title: 'Удаление аккаунта запланировано',
        body: `Аккаунт будет удалён после ${scheduledFor.toLocaleDateString('ru-RU')}, если запрос не отменить.`,
        entityType: 'account_deletion_request',
        entityId: request.id,
      },
    }).catch(() => null);

    return request;
  });
}

export async function cancelAccountDeletion(userId, db = prisma) {
  return db.$transaction(async (tx) => {
    const existing = await tx.accountDeletionRequest.findFirst({
      where: { userId: Number(userId), status: 'pending' },
      orderBy: { requestedAt: 'desc' },
    });
    if (!existing) return null;

    const request = await tx.accountDeletionRequest.update({
      where: { id: existing.id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });

    await tx.user.update({
      where: { id: Number(userId) },
      data: {
        accountStatus: 'active',
        deletionRequestedAt: null,
        deletionScheduledAt: null,
        deletionReason: null,
      },
    });

    await tx.notification.create({
      data: {
        userId: Number(userId),
        type: 'account.deletion.cancelled',
        title: 'Удаление аккаунта отменено',
        body: 'Запрос на удаление аккаунта отменён.',
        entityType: 'account_deletion_request',
        entityId: request.id,
      },
    }).catch(() => null);

    return request;
  });
}

export async function setAccountDeactivation(userId, shouldDeactivate, db = prisma) {
  const data = shouldDeactivate
    ? { accountStatus: 'deactivated', deactivatedAt: new Date() }
    : { accountStatus: 'active', deactivatedAt: null };

  await db.accountDeletionRequest.updateMany({
    where: { userId: Number(userId), status: 'pending' },
    data: { status: 'cancelled', cancelledAt: new Date(), metadata: { reason: 'reactivation_or_deactivation_changed' } },
  }).catch(() => null);

  return db.user.update({
    where: { id: Number(userId) },
    data: {
      ...data,
      deletionRequestedAt: null,
      deletionScheduledAt: null,
      deletionReason: null,
    },
    select: { id: true, accountStatus: true, deactivatedAt: true },
  });
}

export async function anonymizeAndDeleteAccount(userId, { requestId = null } = {}, db = prisma) {
  const id = Number(userId);
  const deletedAt = new Date();
  const suffix = `${id}-${deletedAt.getTime()}-${crypto.randomBytes(3).toString('hex')}`;
  const deletedKey = `deleted.${suffix}`.slice(0, 180);

  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id }, select: { id: true, accountStatus: true } });
    if (!user || user.accountStatus === 'deleted') return { deleted: false, reason: 'already_deleted_or_missing' };

    await tx.post.updateMany({
      where: { authorId: id, deletedAt: null },
      data: { status: 'deleted', deletedAt, moderationReason: 'account_deleted' },
    });
    await tx.comment.updateMany({
      where: { authorId: id, deletedAt: null },
      data: { status: 'deleted', deletedAt, moderationReason: 'account_deleted' },
    });
    await tx.chatMessage.updateMany({
      where: { senderId: id, deletedForAllAt: null },
      data: {
        text: 'Сообщение удалено вместе с аккаунтом.',
        status: 'deleted',
        deletedAt,
        deletedForAllAt: deletedAt,
        mediaUrl: null,
        mediaThumbUrl: null,
        mediaMime: null,
        mediaBytes: null,
        mediaDurationSec: null,
        mediaWidth: null,
        mediaHeight: null,
        mediaWaveform: null,
        ciphertext: null,
        cipherHeader: null,
        cipherAAD: null,
        keyEnvelope: null,
      },
    });

    await Promise.all([
      tx.session.deleteMany({ where: { userId: id } }),
      tx.userDevice.deleteMany({ where: { userId: id } }),
      tx.accountPasskey.deleteMany({ where: { userId: id } }),
      tx.passkeyChallenge.deleteMany({ where: { userId: id } }),
      tx.recoverySession.deleteMany({ where: { userId: id } }),
      tx.e2EEBackup.deleteMany({ where: { userId: id } }).catch(() => null),
      tx.e2EEDevice.deleteMany({ where: { userId: id } }).catch(() => null),
      tx.savedPost.deleteMany({ where: { userId: id } }),
      tx.savedChatMessage.deleteMany({ where: { userId: id } }),
      tx.friendRequest.deleteMany({ where: { OR: [{ fromUserId: id }, { toUserId: id }] } }),
      tx.friendship.deleteMany({ where: { OR: [{ userAId: id }, { userBId: id }] } }),
      tx.subscription.deleteMany({ where: { OR: [{ fromUserId: id }, { toUserId: id }] } }),
      tx.communityJoinRequest.deleteMany({ where: { userId: id } }),
      tx.communityInvite.deleteMany({ where: { OR: [{ createdByUserId: id }, { targetUserId: id }] } }),
    ]);

    await tx.community.updateMany({ where: { ownerId: id }, data: { ownerId: null } });
    await tx.communityMember.updateMany({ where: { userId: id }, data: { status: 'left', role: 'member' } });

    await tx.userPublicProfile.upsert({
      where: { userId: id },
      update: {
        handle: `deleted-${suffix}`.slice(0, 24),
        bio: null,
        occupation: null,
        city: null,
        relationshipStatus: null,
        status: 'recent',
        mutualHint: 0,
      },
      create: {
        userId: id,
        handle: `deleted-${suffix}`.slice(0, 24),
        bio: null,
        occupation: null,
        city: null,
        relationshipStatus: null,
      },
    });

    await tx.user.update({
      where: { id },
      data: {
        firstName: 'Удалённый',
        lastName: 'аккаунт',
        normalizedKey: deletedKey,
        passwordHash: `deleted:${crypto.randomBytes(24).toString('hex')}`,
        secretAnswerHash: `deleted:${crypto.randomBytes(24).toString('hex')}`,
        backupCodeHashes: [],
        recoveryPhraseHash: null,
        behavioralProfile: null,
        behavioralTrustLabel: null,
        behavioralUpdatedAt: null,
        accountStatus: 'deleted',
        deletedAt,
        deactivatedAt: null,
        deletionRequestedAt: null,
        deletionScheduledAt: null,
        deletionReason: null,
      },
    });

    if (requestId) {
      await tx.accountDeletionRequest.update({ where: { id: requestId }, data: { status: 'completed', completedAt: deletedAt } }).catch(() => null);
    } else {
      await tx.accountDeletionRequest.updateMany({ where: { userId: id, status: 'pending' }, data: { status: 'completed', completedAt: deletedAt } });
    }

    return { deleted: true, deletedAt };
  }, { timeout: 30000 });
}

export async function processDueAccountDeletions({ limit = 20, dryRun = true } = {}, db = prisma) {
  const now = new Date();
  const items = await db.accountDeletionRequest.findMany({
    where: { status: 'pending', scheduledFor: { lte: now } },
    orderBy: { scheduledFor: 'asc' },
    take: Math.min(100, Math.max(1, Number(limit) || 20)),
  });

  const results = [];
  for (const item of items) {
    if (dryRun) {
      results.push({ id: item.id, userId: item.userId, action: 'would_delete', scheduledFor: item.scheduledFor });
      continue;
    }
    const result = await anonymizeAndDeleteAccount(item.userId, { requestId: item.id }, db);
    results.push({ id: item.id, userId: item.userId, action: result.deleted ? 'deleted' : 'skipped', reason: result.reason || null });
  }

  return { dryRun, checked: items.length, results };
}

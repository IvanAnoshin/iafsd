import prisma from '@/lib/prisma';

const MAX_PUBLIC_KEY_LENGTH = 12_000;
const MAX_SIGNATURE_LENGTH = 8_000;
const MAX_BLOB_LENGTH = 250_000;
const MAX_LABEL_LENGTH = 120;
const MAX_METADATA_LENGTH = 2_000;
const E2EE_TRANSFER_VERIFICATION_METHOD = 'e2ee_device_transfer';
const E2EE_TRANSFER_TTL_MINUTES = 20;

function toBoundedString(value, limit = 255) {
  const text = String(value || '').trim();
  return text ? text.slice(0, limit) : '';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeBackupMetadata(metadata) {
  const source = safeObject(metadata);
  const next = {};
  const allowedStringFields = ['deviceKeyId', 'format', 'source', 'hint'];
  for (const field of allowedStringFields) {
    const value = toBoundedString(source[field], MAX_METADATA_LENGTH);
    if (value) next[field] = value;
  }
  if (typeof source.createdAt === 'string') {
    const value = toBoundedString(source.createdAt, 120);
    if (value) next.createdAt = value;
  }
  return Object.keys(next).length ? next : null;
}

function serializeDevice(device) {
  if (!device) return null;
  return {
    id: device.id,
    device_key_id: device.deviceKeyId,
    device_label: device.deviceLabel || null,
    is_current: Boolean(device.isCurrent),
    is_trusted: Boolean(device.isTrusted),
    identity_public_key: device.identityPublicKey,
    signed_pre_key_id: device.signedPreKeyId || null,
    signed_pre_key_public: device.signedPreKeyPublic || null,
    signed_pre_key_signature: device.signedPreKeySignature || null,
    last_seen_at: device.lastSeenAt,
    revoked_at: device.revokedAt,
    created_at: device.createdAt,
    updated_at: device.updatedAt,
  };
}

function serializeBackup(backup, options = {}) {
  if (!backup) return null;
  const includeBlob = Boolean(options.includeBlob);
  return {
    id: backup.id,
    backup_version: backup.backupVersion,
    metadata: safeObject(backup.metadata),
    encrypted_blob: includeBlob ? backup.encryptedBlob : null,
    created_at: backup.createdAt,
    updated_at: backup.updatedAt,
    deleted_at: backup.deletedAt,
    restored_at: backup.restoredAt,
  };
}

export async function registerE2EEDevice(userId, payload = {}, db = prisma) {
  const source = safeObject(payload);
  const deviceKeyId = toBoundedString(source.deviceKeyId, 191);
  const identityPublicKey = toBoundedString(source.identityPublicKey, MAX_PUBLIC_KEY_LENGTH);
  const deviceLabel = toBoundedString(source.deviceLabel, MAX_LABEL_LENGTH) || null;
  const signedPreKeyId = toBoundedString(source.signedPreKeyId, 191) || null;
  const signedPreKeyPublic = toBoundedString(source.signedPreKeyPublic, MAX_PUBLIC_KEY_LENGTH) || null;
  const signedPreKeySignature = toBoundedString(source.signedPreKeySignature, MAX_SIGNATURE_LENGTH) || null;
  const trustDevice = source.trustDevice === true;

  if (!deviceKeyId) {
    throw Object.assign(new Error('Не указан deviceKeyId.'), { status: 400 });
  }
  if (!identityPublicKey) {
    throw Object.assign(new Error('Не указан identityPublicKey.'), { status: 400 });
  }

  const now = new Date();

  return db.$transaction(async (tx) => {
    const trustedDeviceCount = await tx.e2EEDevice.count({
      where: {
        userId,
        revokedAt: null,
        isTrusted: true,
      },
    });

    const device = await tx.e2EEDevice.upsert({
      where: {
        userId_deviceKeyId: {
          userId,
          deviceKeyId,
        },
      },
      create: {
        userId,
        deviceKeyId,
        deviceLabel,
        identityPublicKey,
        signedPreKeyId,
        signedPreKeyPublic,
        signedPreKeySignature,
        isCurrent: true,
        isTrusted: trustDevice || trustedDeviceCount === 0,
        lastSeenAt: now,
      },
      update: {
        deviceLabel,
        identityPublicKey,
        signedPreKeyId,
        signedPreKeyPublic,
        signedPreKeySignature,
        isCurrent: true,
        isTrusted: trustDevice ? true : undefined,
        lastSeenAt: now,
        revokedAt: null,
      },
    });

    await tx.e2EEDevice.updateMany({
      where: {
        userId,
        id: { not: device.id },
        isCurrent: true,
      },
      data: {
        isCurrent: false,
      },
    });

    return device;
  });
}

export async function listE2EEDevices(userId, db = prisma) {
  const items = await db.e2EEDevice.findMany({
    where: { userId },
    orderBy: [{ isCurrent: 'desc' }, { isTrusted: 'desc' }, { updatedAt: 'desc' }],
  });
  return items.map(serializeDevice);
}

export async function getCurrentE2EEDevice(userId, db = prisma) {
  const item = await db.e2EEDevice.findFirst({
    where: {
      userId,
      revokedAt: null,
      isCurrent: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  return serializeDevice(item);
}

export async function saveE2EEBackup(userId, payload = {}, db = prisma) {
  const source = safeObject(payload);
  const encryptedBlob = toBoundedString(source.encryptedBlob, MAX_BLOB_LENGTH);
  const metadata = sanitizeBackupMetadata(source.metadata);

  if (!encryptedBlob) {
    throw Object.assign(new Error('Не передан encryptedBlob.'), { status: 400 });
  }

  return db.$transaction(async (tx) => {
    await tx.e2EEBackup.updateMany({
      where: {
        userId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    const backup = await tx.e2EEBackup.create({
      data: {
        userId,
        encryptedBlob,
        metadata,
      },
    });

    return backup;
  });
}

export async function getActiveE2EEBackup(userId, db = prisma, options = {}) {
  const item = await db.e2EEBackup.findFirst({
    where: {
      userId,
      deletedAt: null,
    },
    orderBy: { updatedAt: 'desc' },
  });
  return serializeBackup(item, options);
}

export async function markActiveE2EEBackupRestored(userId, db = prisma) {
  const item = await db.e2EEBackup.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
  });
  if (!item) return null;
  const updated = await db.e2EEBackup.update({
    where: { id: item.id },
    data: { restoredAt: new Date() },
  });
  return serializeBackup(updated);
}

export async function getUserE2EEStatus(userId, db = prisma, options = {}) {
  const currentDeviceKeyId = toBoundedString(options.currentDeviceKeyId, 191);
  const [devices, backup] = await Promise.all([
    db.e2EEDevice.findMany({
      where: {
        userId,
        revokedAt: null,
      },
      orderBy: [{ isCurrent: 'desc' }, { isTrusted: 'desc' }, { updatedAt: 'desc' }],
    }),
    db.e2EEBackup.findFirst({
      where: {
        userId,
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const trustedDevices = devices.filter((item) => item.isTrusted && !item.revokedAt);
  const currentDevice = currentDeviceKeyId
    ? (devices.find((item) => item.deviceKeyId === currentDeviceKeyId && !item.revokedAt) || null)
    : (devices.find((item) => item.isCurrent && !item.revokedAt) || devices[0] || null);

  return {
    ready: Boolean(currentDevice?.isTrusted),
    current_device: serializeDevice(currentDevice),
    trusted_device_count: trustedDevices.length,
    device_count: devices.length,
    requires_transfer: Boolean(currentDevice) && !currentDevice.isTrusted && trustedDevices.length > 0,
    has_recovery_file: Boolean(backup),
    latest_backup: serializeBackup(backup),
    devices: devices.map(serializeDevice),
  };
}

export async function getConversationE2EERecipients(viewerUserId, conversationId, db = prisma) {
  const conversation = await db.conversation.findFirst({
    where: {
      id: String(conversationId),
      members: { some: { userId: Number(viewerUserId) } },
    },
    include: {
      members: {
        select: {
          userId: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { userId: 'asc' },
      },
    },
  });

  if (!conversation) {
    throw Object.assign(new Error('Диалог не найден.'), { status: 404 });
  }

  const memberIds = conversation.members.map((item) => Number(item.userId)).filter((item) => Number.isFinite(item) && item > 0);
  if (!memberIds.length) {
    return { conversation_id: String(conversationId), recipients: [], missing_user_ids: [] };
  }

  const devices = await db.e2EEDevice.findMany({
    where: {
      userId: { in: memberIds },
      revokedAt: null,
    },
    orderBy: [{ isTrusted: 'desc' }, { isCurrent: 'desc' }, { updatedAt: 'desc' }],
  });

  const deviceByUser = new Map();
  for (const device of devices) {
    const key = Number(device.userId);
    if (!deviceByUser.has(key)) deviceByUser.set(key, device);
  }

  const recipients = conversation.members
    .map((member) => {
      const device = deviceByUser.get(Number(member.userId));
      if (!device?.identityPublicKey) return null;
      return {
        user_id: Number(member.userId),
        name: `${member.user?.firstName || ''} ${member.user?.lastName || ''}`.trim() || `user:${member.userId}`,
        device_key_id: device.deviceKeyId,
        public_key: device.identityPublicKey,
        is_trusted: Boolean(device.isTrusted),
      };
    })
    .filter(Boolean);

  const recipientIds = new Set(recipients.map((item) => Number(item.user_id)));
  const missingUserIds = memberIds.filter((item) => !recipientIds.has(Number(item)));

  return {
    conversation_id: conversation.id,
    conversation_type: conversation.type,
    recipients,
    missing_user_ids: missingUserIds,
  };
}


function getE2EETransferExpiryDate() {
  return new Date(Date.now() + E2EE_TRANSFER_TTL_MINUTES * 60 * 1000);
}

function sanitizeTransferMetadata(metadata) {
  const source = safeObject(metadata);
  const next = {
    kind: E2EE_TRANSFER_VERIFICATION_METHOD,
  };
  const allowedFields = [
    'targetDeviceKeyId',
    'targetDeviceLabel',
    'targetDevicePublicKey',
    'approvedAt',
    'approvedByDeviceKeyId',
    'approvedByDeviceLabel',
    'requesterRestoredAt',
  ];
  for (const field of allowedFields) {
    const limit = field === 'targetDevicePublicKey' ? MAX_PUBLIC_KEY_LENGTH : MAX_METADATA_LENGTH;
    const value = toBoundedString(source[field], limit);
    if (value) next[field] = value;
  }
  if (source.transferPackage && typeof source.transferPackage === 'object') {
    next.transferPackage = source.transferPackage;
  }
  return next;
}

function serializeTransferSession(item) {
  if (!item) return null;
  const metadata = safeObject(item.metadata);
  return {
    id: item.id,
    status: item.status,
    expires_at: item.expiresAt,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    completed_at: item.completedAt,
    target_device_key_id: metadata.targetDeviceKeyId || null,
    target_device_label: metadata.targetDeviceLabel || null,
    target_device_public_key: metadata.targetDevicePublicKey || null,
    approved_at: metadata.approvedAt || null,
    approved_by_device_key_id: metadata.approvedByDeviceKeyId || null,
    approved_by_device_label: metadata.approvedByDeviceLabel || null,
    requester_restored_at: metadata.requesterRestoredAt || null,
    package_ready: Boolean(metadata.transferPackage),
    transfer_package: metadata.transferPackage || null,
  };
}

async function expireOldE2EETransferSessions(userId, db = prisma) {
  await db.recoverySession.updateMany({
    where: {
      userId,
      verificationMethod: E2EE_TRANSFER_VERIFICATION_METHOD,
      status: { in: ['pending', 'verified'] },
      expiresAt: { lte: new Date() },
    },
    data: { status: 'expired' },
  }).catch(() => null);
}

export async function createE2EETransferRequest(user, payload = {}, db = prisma) {
  const source = safeObject(payload);
  const targetDeviceKeyId = toBoundedString(source.targetDeviceKeyId, 191);
  const targetDeviceLabel = toBoundedString(source.targetDeviceLabel, MAX_LABEL_LENGTH) || null;
  const targetDevicePublicKey = toBoundedString(source.targetDevicePublicKey, MAX_PUBLIC_KEY_LENGTH);

  if (!targetDeviceKeyId) {
    throw Object.assign(new Error('Не указан targetDeviceKeyId.'), { status: 400 });
  }
  if (!targetDevicePublicKey) {
    throw Object.assign(new Error('Не указан публичный ключ нового устройства.'), { status: 400 });
  }

  await expireOldE2EETransferSessions(user.id, db);

  const targetDevice = await db.e2EEDevice.findUnique({
    where: {
      userId_deviceKeyId: {
        userId: user.id,
        deviceKeyId: targetDeviceKeyId,
      },
    },
  });

  if (!targetDevice) {
    throw Object.assign(new Error('Новое устройство ещё не подготовлено для защищённых чатов.'), { status: 400 });
  }

  const created = await db.recoverySession.create({
    data: {
      userId: user.id,
      normalizedKey: user.normalizedKey,
      verificationMethod: E2EE_TRANSFER_VERIFICATION_METHOD,
      status: 'pending',
      expiresAt: getE2EETransferExpiryDate(),
      metadata: sanitizeTransferMetadata({
        targetDeviceKeyId,
        targetDeviceLabel: targetDeviceLabel || targetDevice.deviceLabel || null,
        targetDevicePublicKey,
      }),
    },
  });

  return serializeTransferSession(created);
}

export async function listE2EETransferRequests(userId, currentDeviceKeyId = '', db = prisma) {
  await expireOldE2EETransferSessions(userId, db);

  const sessions = await db.recoverySession.findMany({
    where: {
      userId,
      verificationMethod: E2EE_TRANSFER_VERIFICATION_METHOD,
      status: { in: ['pending', 'verified'] },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const serialized = sessions.map(serializeTransferSession);
  const normalizedCurrentDeviceKeyId = toBoundedString(currentDeviceKeyId, 191);
  const outgoingRequest = normalizedCurrentDeviceKeyId
    ? serialized.find((item) => item.target_device_key_id === normalizedCurrentDeviceKeyId) || null
    : null;
  const incomingRequests = normalizedCurrentDeviceKeyId
    ? serialized.filter((item) => item.target_device_key_id && item.target_device_key_id !== normalizedCurrentDeviceKeyId)
    : serialized;
  const readyTransfer = outgoingRequest?.package_ready ? outgoingRequest : null;

  return {
    ready_transfer: readyTransfer,
    outgoing_request: outgoingRequest,
    incoming_requests: incomingRequests,
    requests: serialized,
  };
}

export async function approveE2EETransferRequest(userId, payload = {}, db = prisma) {
  const source = safeObject(payload);
  const requestId = toBoundedString(source.requestId, 191);
  const approverDeviceKeyId = toBoundedString(source.approverDeviceKeyId, 191);
  const transferPackage = safeObject(source.transferPackage);

  if (!requestId) {
    throw Object.assign(new Error('Не указан requestId для переноса устройства.'), { status: 400 });
  }
  if (!approverDeviceKeyId) {
    throw Object.assign(new Error('Не указан ключ доверенного устройства.'), { status: 400 });
  }
  if (!transferPackage.ciphertext || !transferPackage.iv || !safeObject(transferPackage.wrappedKey).ciphertext) {
    throw Object.assign(new Error('Пакет переноса устройства повреждён.'), { status: 400 });
  }

  const [request, approverDevice] = await Promise.all([
    db.recoverySession.findFirst({
      where: {
        id: requestId,
        userId,
        verificationMethod: E2EE_TRANSFER_VERIFICATION_METHOD,
        status: { in: ['pending', 'verified'] },
      },
    }),
    db.e2EEDevice.findUnique({
      where: {
        userId_deviceKeyId: {
          userId,
          deviceKeyId: approverDeviceKeyId,
        },
      },
    }),
  ]);

  if (!request) {
    throw Object.assign(new Error('Запрос на перенос устройства не найден или уже истёк.'), { status: 404 });
  }
  if (!approverDevice || approverDevice.revokedAt || !approverDevice.isTrusted) {
    throw Object.assign(new Error('Подтверждать перенос можно только с доверенного устройства.'), { status: 403 });
  }

  const metadata = sanitizeTransferMetadata({
    ...safeObject(request.metadata),
    approvedAt: new Date().toISOString(),
    approvedByDeviceKeyId: approverDeviceKeyId,
    approvedByDeviceLabel: approverDevice.deviceLabel || null,
    transferPackage,
  });

  const updated = await db.recoverySession.update({
    where: { id: request.id },
    data: {
      status: 'verified',
      metadata,
      verifiedAt: new Date(),
    },
  });

  return serializeTransferSession(updated);
}

export async function completeE2EETransferRequest(userId, payload = {}, db = prisma) {
  const source = safeObject(payload);
  const requestId = toBoundedString(source.requestId, 191);
  const targetDeviceKeyId = toBoundedString(source.targetDeviceKeyId, 191);

  if (!requestId || !targetDeviceKeyId) {
    throw Object.assign(new Error('Не хватает данных для завершения переноса устройства.'), { status: 400 });
  }

  const request = await db.recoverySession.findFirst({
    where: {
      id: requestId,
      userId,
      verificationMethod: E2EE_TRANSFER_VERIFICATION_METHOD,
      status: 'verified',
    },
  });

  if (!request) {
    throw Object.assign(new Error('Подтверждённый перенос устройства не найден.'), { status: 404 });
  }

  const metadata = safeObject(request.metadata);
  if (toBoundedString(metadata.targetDeviceKeyId, 191) !== targetDeviceKeyId) {
    throw Object.assign(new Error('Этот перенос подготовлен для другого устройства.'), { status: 403 });
  }

  const updated = await db.recoverySession.update({
    where: { id: request.id },
    data: {
      status: 'completed',
      completedAt: new Date(),
      metadata: sanitizeTransferMetadata({
        ...metadata,
        requesterRestoredAt: new Date().toISOString(),
      }),
    },
  });

  return serializeTransferSession(updated);
}

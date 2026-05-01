-- Messenger wave 1: media + E2EE + calls core

ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "lastMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastMessageType" TEXT,
  ADD COLUMN IF NOT EXISTS "lastSenderId" INTEGER,
  ADD COLUMN IF NOT EXISTS "lastPreviewText" TEXT,
  ADD COLUMN IF NOT EXISTS "lastPreviewMeta" JSONB;

ALTER TABLE "ConversationMember"
  ADD COLUMN IF NOT EXISTS "lastDeliveredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "unreadCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "notificationsMode" TEXT NOT NULL DEFAULT 'default';

ALTER TABLE "ChatMessage"
  ADD COLUMN IF NOT EXISTS "messageVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "systemType" TEXT,
  ADD COLUMN IF NOT EXISTS "serverAckAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failureCode" TEXT,
  ADD COLUMN IF NOT EXISTS "mediaKind" TEXT,
  ADD COLUMN IF NOT EXISTS "mediaUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "mediaThumbUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "mediaMime" TEXT,
  ADD COLUMN IF NOT EXISTS "mediaBytes" INTEGER,
  ADD COLUMN IF NOT EXISTS "mediaDurationSec" INTEGER,
  ADD COLUMN IF NOT EXISTS "mediaWidth" INTEGER,
  ADD COLUMN IF NOT EXISTS "mediaHeight" INTEGER,
  ADD COLUMN IF NOT EXISTS "mediaWaveform" JSONB,
  ADD COLUMN IF NOT EXISTS "isEncrypted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "encryptionScheme" TEXT,
  ADD COLUMN IF NOT EXISTS "senderDeviceId" TEXT,
  ADD COLUMN IF NOT EXISTS "recipientDeviceId" TEXT,
  ADD COLUMN IF NOT EXISTS "ciphertext" TEXT,
  ADD COLUMN IF NOT EXISTS "cipherHeader" TEXT,
  ADD COLUMN IF NOT EXISTS "cipherAAD" TEXT,
  ADD COLUMN IF NOT EXISTS "contentHint" TEXT,
  ADD COLUMN IF NOT EXISTS "keyEnvelope" TEXT,
  ADD COLUMN IF NOT EXISTS "deletedForAllAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "E2EEDevice" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "deviceKeyId" TEXT NOT NULL,
  "deviceLabel" TEXT,
  "identityPublicKey" TEXT NOT NULL,
  "signedPreKeyId" TEXT,
  "signedPreKeyPublic" TEXT,
  "signedPreKeySignature" TEXT,
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "isTrusted" BOOLEAN NOT NULL DEFAULT false,
  "revokedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "E2EEDevice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "E2EEDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "E2EEPreKey" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "publicKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'available',
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "E2EEPreKey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "E2EEPreKey_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "E2EEDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "E2EEBackup" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "backupVersion" INTEGER NOT NULL DEFAULT 1,
  "encryptedBlob" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "restoredAt" TIMESTAMP(3),
  CONSTRAINT "E2EEBackup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "E2EEBackup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CallSession" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "initiatorId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "endedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CallSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CallSession_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CallParticipant" (
  "id" TEXT NOT NULL,
  "callSessionId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'participant',
  "joinedAt" TIMESTAMP(3),
  "leftAt" TIMESTAMP(3),
  "state" TEXT NOT NULL,
  "isMicOn" BOOLEAN NOT NULL DEFAULT true,
  "isCameraOn" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "CallParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CallParticipant_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CallParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CallEvent" (
  "id" TEXT NOT NULL,
  "callSessionId" TEXT NOT NULL,
  "actorUserId" INTEGER,
  "eventType" TEXT NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CallEvent_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CallEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "E2EEDevice_userId_deviceKeyId_key" ON "E2EEDevice"("userId", "deviceKeyId");
CREATE INDEX IF NOT EXISTS "E2EEDevice_userId_revokedAt_idx" ON "E2EEDevice"("userId", "revokedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "E2EEPreKey_deviceId_keyId_key" ON "E2EEPreKey"("deviceId", "keyId");
CREATE INDEX IF NOT EXISTS "E2EEBackup_userId_updatedAt_idx" ON "E2EEBackup"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "CallSession_conversationId_createdAt_idx" ON "CallSession"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "CallSession_initiatorId_createdAt_idx" ON "CallSession"("initiatorId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "CallParticipant_callSessionId_userId_key" ON "CallParticipant"("callSessionId", "userId");
CREATE INDEX IF NOT EXISTS "CallParticipant_userId_joinedAt_idx" ON "CallParticipant"("userId", "joinedAt");
CREATE INDEX IF NOT EXISTS "CallEvent_callSessionId_createdAt_idx" ON "CallEvent"("callSessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "ConversationMember_userId_archivedAt_idx" ON "ConversationMember"("userId", "archivedAt");
CREATE INDEX IF NOT EXISTS "ConversationMember_userId_unreadCount_idx" ON "ConversationMember"("userId", "unreadCount");
CREATE INDEX IF NOT EXISTS "ChatMessage_conversationId_deletedAt_createdAt_idx" ON "ChatMessage"("conversationId", "deletedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatMessage_conversationId_type_createdAt_idx" ON "ChatMessage"("conversationId", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatMessage_replyToMessageId_idx" ON "ChatMessage"("replyToMessageId");
CREATE INDEX IF NOT EXISTS "ChatMessage_senderDeviceId_idx" ON "ChatMessage"("senderDeviceId");
CREATE INDEX IF NOT EXISTS "ChatMessage_isEncrypted_createdAt_idx" ON "ChatMessage"("isEncrypted", "createdAt");

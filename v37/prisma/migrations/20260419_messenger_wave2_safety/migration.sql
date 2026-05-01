CREATE TABLE IF NOT EXISTS "MessengerSafetyFlag" (
  "id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'medium',
  "status" TEXT NOT NULL DEFAULT 'open',
  "dedupeKey" TEXT,
  "actorUserId" INTEGER,
  "targetUserId" INTEGER,
  "conversationId" TEXT,
  "messageId" TEXT,
  "details" JSONB,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "lastTriggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "MessengerSafetyFlag_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MessengerSafetyFlag_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MessengerSafetyFlag_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "MessengerSafetyFlag_status_createdAt_idx" ON "MessengerSafetyFlag"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "MessengerSafetyFlag_targetUserId_status_createdAt_idx" ON "MessengerSafetyFlag"("targetUserId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "MessengerSafetyFlag_actorUserId_createdAt_idx" ON "MessengerSafetyFlag"("actorUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "MessengerSafetyFlag_dedupeKey_status_idx" ON "MessengerSafetyFlag"("dedupeKey", "status");

CREATE TABLE IF NOT EXISTS "MessengerPeerBlock" (
  "id" TEXT NOT NULL,
  "blockerUserId" INTEGER NOT NULL,
  "blockedUserId" INTEGER NOT NULL,
  "conversationId" TEXT NOT NULL,
  "reason" TEXT,
  "details" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessengerPeerBlock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MessengerPeerBlock_blockerUserId_blockedUserId_conversationId_key" ON "MessengerPeerBlock"("blockerUserId", "blockedUserId", "conversationId");
CREATE INDEX IF NOT EXISTS "MessengerPeerBlock_blockerUserId_createdAt_idx" ON "MessengerPeerBlock"("blockerUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "MessengerPeerBlock_blockedUserId_createdAt_idx" ON "MessengerPeerBlock"("blockedUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "MessengerPeerBlock_conversationId_createdAt_idx" ON "MessengerPeerBlock"("conversationId", "createdAt");

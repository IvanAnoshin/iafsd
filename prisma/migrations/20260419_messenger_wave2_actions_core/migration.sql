-- Messenger wave 2 (actions core): save message + message report

CREATE TABLE IF NOT EXISTS "SavedChatMessage" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "messageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedChatMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavedChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SavedChatMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ChatMessageReport" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "reporterUserId" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "status" TEXT NOT NULL DEFAULT 'new',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessageReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatMessageReport_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatMessageReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SavedChatMessage_userId_messageId_key" ON "SavedChatMessage"("userId", "messageId");
CREATE INDEX IF NOT EXISTS "SavedChatMessage_userId_createdAt_idx" ON "SavedChatMessage"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "SavedChatMessage_messageId_idx" ON "SavedChatMessage"("messageId");

CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessageReport_messageId_reporterUserId_key" ON "ChatMessageReport"("messageId", "reporterUserId");
CREATE INDEX IF NOT EXISTS "ChatMessageReport_reporterUserId_createdAt_idx" ON "ChatMessageReport"("reporterUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatMessageReport_status_createdAt_idx" ON "ChatMessageReport"("status", "createdAt");

-- Messenger wave 2: message pins

CREATE TABLE IF NOT EXISTS "PinnedChatMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "pinnedByUserId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PinnedChatMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PinnedChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PinnedChatMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PinnedChatMessage_pinnedByUserId_fkey" FOREIGN KEY ("pinnedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PinnedChatMessage_conversationId_messageId_key" ON "PinnedChatMessage"("conversationId", "messageId");
CREATE INDEX IF NOT EXISTS "PinnedChatMessage_conversationId_createdAt_idx" ON "PinnedChatMessage"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "PinnedChatMessage_pinnedByUserId_createdAt_idx" ON "PinnedChatMessage"("pinnedByUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "PinnedChatMessage_messageId_idx" ON "PinnedChatMessage"("messageId");

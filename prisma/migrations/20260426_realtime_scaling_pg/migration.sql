-- v91 Realtime scaling: persisted fan-out events for Postgres LISTEN/NOTIFY transport.
CREATE TABLE IF NOT EXISTS "RealtimeEvent" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "event" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "origin" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RealtimeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "RealtimeEvent_userId_id_idx" ON "RealtimeEvent"("userId", "id");
CREATE INDEX IF NOT EXISTS "RealtimeEvent_expiresAt_idx" ON "RealtimeEvent"("expiresAt");
CREATE INDEX IF NOT EXISTS "RealtimeEvent_origin_createdAt_idx" ON "RealtimeEvent"("origin", "createdAt");

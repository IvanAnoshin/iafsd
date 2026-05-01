-- v89: account deletion and data export control.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "accountStatus" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletionScheduledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_accountStatus_deletionScheduledAt_idx"
  ON "User"("accountStatus", "deletionScheduledAt");

CREATE TABLE IF NOT EXISTS "UserDataExport" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "format" TEXT NOT NULL DEFAULT 'json',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "UserDataExport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserDataExport_userId_requestedAt_idx"
  ON "UserDataExport"("userId", "requestedAt");
CREATE INDEX IF NOT EXISTS "UserDataExport_status_expiresAt_idx"
  ON "UserDataExport"("status", "expiresAt");

DO $$ BEGIN
  ALTER TABLE "UserDataExport"
    ADD CONSTRAINT "UserDataExport_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AccountDeletionRequest" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_userId_status_requestedAt_idx"
  ON "AccountDeletionRequest"("userId", "status", "requestedAt");
CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_status_scheduledFor_idx"
  ON "AccountDeletionRequest"("status", "scheduledFor");

DO $$ BEGIN
  ALTER TABLE "AccountDeletionRequest"
    ADD CONSTRAINT "AccountDeletionRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- v92 Storage Production Hardening
CREATE TABLE IF NOT EXISTS "MediaObject" (
  "id" TEXT NOT NULL,
  "ownerUserId" INTEGER,
  "surface" TEXT NOT NULL,
  "scopeType" TEXT,
  "scopeId" TEXT,
  "kind" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "detectedMime" TEXT,
  "storage" TEXT NOT NULL DEFAULT 'local',
  "storageKey" TEXT,
  "previewStorageKey" TEXT,
  "url" TEXT,
  "thumbUrl" TEXT,
  "bytes" INTEGER NOT NULL DEFAULT 0,
  "previewBytes" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "MediaObject_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MediaObject_ownerUserId_createdAt_idx" ON "MediaObject"("ownerUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "MediaObject_surface_scopeId_createdAt_idx" ON "MediaObject"("surface", "scopeId", "createdAt");
CREATE INDEX IF NOT EXISTS "MediaObject_storage_storageKey_idx" ON "MediaObject"("storage", "storageKey");
CREATE INDEX IF NOT EXISTS "MediaObject_status_createdAt_idx" ON "MediaObject"("status", "createdAt");

CREATE TABLE "UserPreference" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "profileVisibility" TEXT NOT NULL DEFAULT 'everyone',
  "photoVisibility" TEXT NOT NULL DEFAULT 'connections',
  "activityVisibility" TEXT NOT NULL DEFAULT 'connections',
  "messagePermission" TEXT NOT NULL DEFAULT 'everyone',
  "messageRequestsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "notifyMessages" BOOLEAN NOT NULL DEFAULT true,
  "notifyMessageRequests" BOOLEAN NOT NULL DEFAULT true,
  "notifyComments" BOOLEAN NOT NULL DEFAULT true,
  "notifyReactions" BOOLEAN NOT NULL DEFAULT true,
  "notifyFollows" BOOLEAN NOT NULL DEFAULT true,
  "appearance" TEXT NOT NULL DEFAULT 'system',
  "visionMode" TEXT NOT NULL DEFAULT 'none',
  "reducedMotion" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

ALTER TABLE "UserPreference"
ADD CONSTRAINT "UserPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

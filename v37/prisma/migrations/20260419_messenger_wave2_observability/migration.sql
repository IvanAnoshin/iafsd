CREATE TABLE IF NOT EXISTS "MessengerMetricEvent" (
  "id" TEXT NOT NULL,
  "userId" INTEGER,
  "conversationId" TEXT,
  "callSessionId" TEXT,
  "category" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "value" DOUBLE PRECISION,
  "durationMs" INTEGER,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessengerMetricEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MessengerMetricEvent_createdAt_idx" ON "MessengerMetricEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "MessengerMetricEvent_category_metric_createdAt_idx" ON "MessengerMetricEvent"("category", "metric", "createdAt");
CREATE INDEX IF NOT EXISTS "MessengerMetricEvent_metric_outcome_createdAt_idx" ON "MessengerMetricEvent"("metric", "outcome", "createdAt");
CREATE INDEX IF NOT EXISTS "MessengerMetricEvent_userId_createdAt_idx" ON "MessengerMetricEvent"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "MessengerMetricEvent_conversationId_createdAt_idx" ON "MessengerMetricEvent"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "MessengerMetricEvent_callSessionId_createdAt_idx" ON "MessengerMetricEvent"("callSessionId", "createdAt");

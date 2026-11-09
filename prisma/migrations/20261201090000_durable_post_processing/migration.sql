ALTER TABLE "Post"
  ADD COLUMN "processingState" TEXT NOT NULL DEFAULT 'done',
  ADD COLUMN "processingToken" TEXT,
  ADD COLUMN "processingRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "processingQueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "processingError" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Post_processingState_processingRetryAt_idx" ON "Post"("processingState","processingRetryAt");
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
-- Recover recent acknowledgments that never reached deterministic enrichment.
UPDATE "Post" SET "processingState"='pending_new'
WHERE "scoreReason"='' AND "createdAt">=CURRENT_TIMESTAMP-INTERVAL '24 hours'
  AND ("aiProvider" IS NULL OR "aiProvider" LIKE 'rules%');
ALTER TABLE "Post" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;

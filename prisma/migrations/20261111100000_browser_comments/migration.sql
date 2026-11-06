-- Additive: old rules retain their existing transport; new browser rules require explicit consent.
ALTER TABLE "AutoCommentRule"
  ADD COLUMN "deliveryMode" TEXT NOT NULL DEFAULT 'official',
  ADD COLUMN "browserDeviceId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "browserFbUserId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "browserConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requireAi" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "messageMode" TEXT NOT NULL DEFAULT 'template';
ALTER TABLE "AutoCommentJob"
  ADD COLUMN "deliveryMode" TEXT NOT NULL DEFAULT 'official',
  ADD COLUMN "browserDeviceId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "browserFbUserId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "AutoCommentJob_browser_queue_idx" ON "AutoCommentJob" ("deliveryMode", "browserDeviceId", "status", "nextAttemptAt");
ALTER TABLE "AutoCommentRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutoCommentJob" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Post" ADD COLUMN "embeddingKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Post" ADD COLUMN "embeddingConfig" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Post" ADD COLUMN "embeddingRetryAt" DATETIME NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
ALTER TABLE "AiJob" ADD COLUMN "queueWaitMs" INTEGER;
CREATE INDEX "Post_normalizedText_idx" ON "Post"("normalizedText");
CREATE INDEX "Post_sourceId_duplicateOfId_createdAt_idx" ON "Post"("sourceId", "duplicateOfId", "createdAt");
CREATE INDEX "Post_embeddingConfig_embeddingRetryAt_idx" ON "Post"("embeddingConfig", "embeddingRetryAt");
CREATE INDEX "AiJob_status_updatedAt_idx" ON "AiJob"("status", "updatedAt");

ALTER TABLE "AutoCommentEvaluation" ADD COLUMN "inputFingerprint" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AutoCommentRule" ADD COLUMN "businessFacts" TEXT NOT NULL DEFAULT '', ADD COLUMN "draftInstruction" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AutoCommentJob" ADD COLUMN "draftInputKey" TEXT NOT NULL DEFAULT '', ADD COLUMN "draftProvider" TEXT NOT NULL DEFAULT '';
CREATE TABLE "IngestReceipt" (
 "id" TEXT NOT NULL PRIMARY KEY, "deviceKey" TEXT NOT NULL, "batchId" TEXT NOT NULL, "itemId" TEXT NOT NULL,
 "outcome" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE UNIQUE INDEX "IngestReceipt_deviceKey_batchId_itemId_key" ON "IngestReceipt"("deviceKey","batchId","itemId");
CREATE INDEX "IngestReceipt_createdAt_idx" ON "IngestReceipt"("createdAt");
ALTER TABLE "IngestReceipt" ENABLE ROW LEVEL SECURITY;

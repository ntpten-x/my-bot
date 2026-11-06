BEGIN;
-- CreateTable
CREATE TABLE "AutoCommentRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "sourceIdsJson" TEXT NOT NULL DEFAULT '[]',
    "keywords" TEXT NOT NULL DEFAULT '',
    "excludeKeywords" TEXT NOT NULL DEFAULT '',
    "keywordMode" TEXT NOT NULL DEFAULT 'any',
    "selectionMode" TEXT NOT NULL DEFAULT 'sequential',
    "nextTemplate" INTEGER NOT NULL DEFAULT 0,
    "startMinute" INTEGER NOT NULL DEFAULT 0,
    "endMinute" INTEGER NOT NULL DEFAULT 1440,
    "daysJson" TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    "maxAgeHours" INTEGER NOT NULL DEFAULT 24,
    "areaCooldownSec" INTEGER NOT NULL DEFAULT 300,
    "pageId" TEXT NOT NULL DEFAULT '',
    "pageTokenEnc" TEXT,
    "managerTokenEnc" TEXT,
    "pausedReason" TEXT NOT NULL DEFAULT '',
    "lastPolledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoCommentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoCommentTemplate" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutoCommentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoCommentJob" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "postId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "postKey" TEXT NOT NULL,
    "externalUrl" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL DEFAULT '',
    "remotePostId" TEXT NOT NULL DEFAULT '',
    "ruleRevision" INTEGER NOT NULL,
    "textRevision" INTEGER NOT NULL,
    "generation" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimToken" TEXT,
    "claimUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "remoteCommentId" TEXT,
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoCommentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoCommentLog" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "jobId" TEXT,
    "eventKey" TEXT,
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "pageId" TEXT NOT NULL DEFAULT '',
    "sourceId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutoCommentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutoCommentRule_enabled_createdAt_idx" ON "AutoCommentRule"("enabled", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutoCommentTemplate_ruleId_sortOrder_key" ON "AutoCommentTemplate"("ruleId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AutoCommentJob_dedupeKey_key" ON "AutoCommentJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "AutoCommentJob_status_nextAttemptAt_idx" ON "AutoCommentJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AutoCommentJob_sourceId_dispatchedAt_idx" ON "AutoCommentJob"("sourceId", "dispatchedAt");

-- CreateIndex
CREATE INDEX "AutoCommentJob_pageId_dispatchedAt_idx" ON "AutoCommentJob"("pageId", "dispatchedAt");

-- CreateIndex
CREATE INDEX "AutoCommentJob_generation_status_idx" ON "AutoCommentJob"("generation", "status");

-- CreateIndex
CREATE INDEX "AutoCommentJob_postId_idx" ON "AutoCommentJob"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoCommentLog_eventKey_key" ON "AutoCommentLog"("eventKey");

-- CreateIndex
CREATE INDEX "AutoCommentLog_event_createdAt_idx" ON "AutoCommentLog"("event", "createdAt");

-- CreateIndex
CREATE INDEX "AutoCommentLog_pageId_event_createdAt_idx" ON "AutoCommentLog"("pageId", "event", "createdAt");

-- CreateIndex
CREATE INDEX "AutoCommentLog_sourceId_event_createdAt_idx" ON "AutoCommentLog"("sourceId", "event", "createdAt");

-- CreateIndex
CREATE INDEX "AutoCommentLog_jobId_idx" ON "AutoCommentLog"("jobId");

-- AddForeignKey
ALTER TABLE "AutoCommentTemplate" ADD CONSTRAINT "AutoCommentTemplate_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutoCommentRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoCommentJob" ADD CONSTRAINT "AutoCommentJob_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutoCommentRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoCommentJob" ADD CONSTRAINT "AutoCommentJob_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoCommentLog" ADD CONSTRAINT "AutoCommentLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutoCommentRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoCommentLog" ADD CONSTRAINT "AutoCommentLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AutoCommentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "AutoCommentRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutoCommentTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutoCommentJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutoCommentLog" ENABLE ROW LEVEL SECURITY;
COMMIT;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" TIMESTAMP(3),
    "lastExtensionAt" TIMESTAMP(3),
    "lastError" TEXT,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "matchWords" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalUrl" TEXT NOT NULL,
    "authorName" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "imagesJson" TEXT NOT NULL DEFAULT '[]',
    "categoryId" TEXT,
    "subcategoryId" TEXT,
    "intent" TEXT NOT NULL DEFAULT 'unknown',
    "province" TEXT,
    "isAd" BOOLEAN NOT NULL DEFAULT false,
    "keywordHitsJson" TEXT NOT NULL DEFAULT '[]',
    "forbiddenHit" BOOLEAN NOT NULL DEFAULT false,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isSaved" BOOLEAN NOT NULL DEFAULT false,
    "pipelineStatus" TEXT NOT NULL DEFAULT 'none',
    "suggestedReply" TEXT NOT NULL DEFAULT '',
    "aiProvider" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoreReason" TEXT NOT NULL DEFAULT '',
    "embeddingJson" TEXT NOT NULL DEFAULT '',
    "embeddingKey" TEXT NOT NULL DEFAULT '',
    "embeddingConfig" TEXT NOT NULL DEFAULT '',
    "embeddingRetryAt" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00 +00:00',
    "duplicateOfId" TEXT,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "ocrText" TEXT NOT NULL DEFAULT '',
    "extraUrlsJson" TEXT NOT NULL DEFAULT '[]',
    "followUpAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT NOT NULL DEFAULT '',
    "latencyMs" INTEGER,
    "queueWaitMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrCache" (
    "imageHash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrCache_pkey" PRIMARY KEY ("imageHash")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenceWeight" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreferenceWeight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Summary" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "channel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AiCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FetchTask" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message" TEXT NOT NULL DEFAULT '',
    "postsFound" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "FetchTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParseSample" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParseSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FetchLog" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "postsFound" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FetchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "categoryId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" TEXT,
    "keywords" TEXT NOT NULL DEFAULT '',
    "provinces" TEXT NOT NULL DEFAULT '',
    "intent" TEXT NOT NULL DEFAULT '',
    "minScore" INTEGER NOT NULL DEFAULT 0,
    "actionNotify" BOOLEAN NOT NULL DEFAULT true,
    "actionSave" BOOLEAN NOT NULL DEFAULT false,
    "actionDismiss" BOOLEAN NOT NULL DEFAULT false,
    "templateId" TEXT,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleHit" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyQueueItem" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "authorKey" TEXT NOT NULL DEFAULT '',
    "templateId" TEXT,
    "text" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "openedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplyQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Source_url_key" ON "Source"("url");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Post_contentHash_key" ON "Post"("contentHash");

-- CreateIndex
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");

-- CreateIndex
CREATE INDEX "Post_isRead_idx" ON "Post"("isRead");

-- CreateIndex
CREATE INDEX "Post_pipelineStatus_idx" ON "Post"("pipelineStatus");

-- CreateIndex
CREATE INDEX "Post_province_idx" ON "Post"("province");

-- CreateIndex
CREATE INDEX "Post_score_idx" ON "Post"("score");

-- CreateIndex
CREATE INDEX "Post_normalizedText_idx" ON "Post" USING HASH ("normalizedText");

-- CreateIndex
CREATE INDEX "Post_sourceId_duplicateOfId_createdAt_idx" ON "Post"("sourceId", "duplicateOfId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_embeddingConfig_embeddingRetryAt_idx" ON "Post"("embeddingConfig", "embeddingRetryAt");

-- CreateIndex
CREATE INDEX "Post_followUpAt_idx" ON "Post"("followUpAt");

-- CreateIndex
CREATE INDEX "Post_duplicateOfId_idx" ON "Post"("duplicateOfId");

-- CreateIndex
CREATE UNIQUE INDEX "Post_sourceId_externalUrl_key" ON "Post"("sourceId", "externalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "AiJob_postId_key" ON "AiJob"("postId");

-- CreateIndex
CREATE INDEX "AiJob_status_nextAttemptAt_idx" ON "AiJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AiJob_status_updatedAt_idx" ON "AiJob"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Feedback_postId_createdAt_idx" ON "Feedback"("postId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenceWeight_kind_key_key" ON "PreferenceWeight"("kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Summary_day_key" ON "Summary"("day");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_word_type_key" ON "Keyword"("word", "type");

-- CreateIndex
CREATE INDEX "Notification_read_createdAt_idx" ON "Notification"("read", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiCache_cacheKey_key" ON "AiCache"("cacheKey");

-- CreateIndex
CREATE INDEX "FetchTask_status_createdAt_idx" ON "FetchTask"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FetchLog_createdAt_idx" ON "FetchLog"("createdAt");

-- CreateIndex
CREATE INDEX "RuleHit_postId_idx" ON "RuleHit"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleHit_ruleId_postId_key" ON "RuleHit"("ruleId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplyQueueItem_postId_key" ON "ReplyQueueItem"("postId");

-- CreateIndex
CREATE INDEX "ReplyQueueItem_day_status_idx" ON "ReplyQueueItem"("day", "status");

-- CreateIndex
CREATE INDEX "ReplyQueueItem_status_createdAt_idx" ON "ReplyQueueItem"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReplyQueueItem_authorKey_createdAt_idx" ON "ReplyQueueItem"("authorKey", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FetchTask" ADD CONSTRAINT "FetchTask_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FetchLog" ADD CONSTRAINT "FetchLog_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleHit" ADD CONSTRAINT "RuleHit_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyQueueItem" ADD CONSTRAINT "ReplyQueueItem_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Supabase: enable Row Level Security on every table with no policies, so the public
-- publishable/anon key cannot read or write these tables through the Data API.
-- MY-BOT connects directly to Postgres as the table owner, which bypasses RLS.
ALTER TABLE IF EXISTS "Owner" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Source" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Post" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "AiJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "OcrCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "PreferenceWeight" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Summary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Keyword" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Note" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Setting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "AiCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "FetchTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "ParseSample" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "FetchLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "ReplyTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "AutomationRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "RuleHit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "ReplyQueueItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

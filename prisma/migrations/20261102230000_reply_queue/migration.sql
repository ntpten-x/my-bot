-- AlterTable
ALTER TABLE "Post" ADD COLUMN "repliedAt" DATETIME;

-- CreateTable
CREATE TABLE "ReplyQueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "authorKey" TEXT NOT NULL DEFAULT '',
    "templateId" TEXT,
    "text" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "openedAt" DATETIME,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReplyQueueItem_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ReplyQueueItem_postId_key" ON "ReplyQueueItem"("postId");

-- CreateIndex
CREATE INDEX "ReplyQueueItem_day_status_idx" ON "ReplyQueueItem"("day", "status");

-- CreateIndex
CREATE INDEX "ReplyQueueItem_status_createdAt_idx" ON "ReplyQueueItem"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReplyQueueItem_authorKey_createdAt_idx" ON "ReplyQueueItem"("authorKey", "createdAt");


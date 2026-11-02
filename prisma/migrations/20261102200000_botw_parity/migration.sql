-- AlterTable
ALTER TABLE "Post" ADD COLUMN "followUpAt" DATETIME;
ALTER TABLE "Post" ADD COLUMN "statusChangedAt" DATETIME;

-- CreateTable
CREATE TABLE "ReplyTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "categoryId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "lastHitAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RuleHit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RuleHit_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RuleHit_postId_idx" ON "RuleHit"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleHit_ruleId_postId_key" ON "RuleHit"("ruleId", "postId");

-- CreateIndex
CREATE INDEX "Post_followUpAt_idx" ON "Post"("followUpAt");

-- CreateIndex
CREATE INDEX "Post_duplicateOfId_idx" ON "Post"("duplicateOfId");


-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "actionQueue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "excludeKeywords" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "maxAgeHours" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "sourceIds" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "subcategoryId" TEXT,
ADD COLUMN     "templateIds" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ReplyQueueItem" ADD COLUMN     "ruleId" TEXT;


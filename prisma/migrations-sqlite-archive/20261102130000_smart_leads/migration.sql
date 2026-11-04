-- AlterTable
ALTER TABLE "Post" ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Post" ADD COLUMN "scoreReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Post" ADD COLUMN "embeddingJson" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Post" ADD COLUMN "duplicateOfId" TEXT;
ALTER TABLE "Post" ADD COLUMN "dismissed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Post_score_idx" ON "Post"("score");

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Feedback_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Feedback_postId_createdAt_idx" ON "Feedback"("postId", "createdAt");

-- CreateTable
CREATE TABLE "PreferenceWeight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PreferenceWeight_kind_key_key" ON "PreferenceWeight"("kind", "key");

-- CreateTable
CREATE TABLE "Summary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "day" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Summary_day_key" ON "Summary"("day");

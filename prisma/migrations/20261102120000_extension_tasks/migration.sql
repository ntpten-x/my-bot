-- AlterTable
ALTER TABLE "Source" ADD COLUMN "lastExtensionAt" DATETIME;

-- CreateTable
CREATE TABLE "FetchTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message" TEXT NOT NULL DEFAULT '',
    "postsFound" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "FetchTask_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FetchTask_status_createdAt_idx" ON "FetchTask"("status", "createdAt");

-- CreateTable
CREATE TABLE "ParseSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceUrl" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AlterTable
ALTER TABLE "FetchTask" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'scrape';

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" TEXT NOT NULL DEFAULT 'normal',
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "found" INTEGER NOT NULL DEFAULT 0,
    "fresh" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "scrolls" INTEGER NOT NULL DEFAULT 0,
    "stoppedBy" TEXT NOT NULL DEFAULT '',
    "reachedKnown" BOOLEAN NOT NULL DEFAULT false,
    "hitLimit" BOOLEAN NOT NULL DEFAULT false,
    "stalls" INTEGER NOT NULL DEFAULT 0,
    "usedWindow" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScrapeRun_sourceId_createdAt_idx" ON "ScrapeRun"("sourceId", "createdAt");

-- AddForeignKey
ALTER TABLE "ScrapeRun" ADD CONSTRAINT "ScrapeRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
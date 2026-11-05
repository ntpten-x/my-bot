-- CreateTable
CREATE TABLE "PostTombstone" (
    "contentHash" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostTombstone_pkey" PRIMARY KEY ("contentHash")
);

-- CreateIndex
CREATE INDEX "PostTombstone_sourceId_externalUrl_idx" ON "PostTombstone"("sourceId", "externalUrl");

-- CreateIndex
CREATE INDEX "PostTombstone_createdAt_idx" ON "PostTombstone"("createdAt");

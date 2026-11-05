CREATE TABLE "Lease" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Lease_pkey" PRIMARY KEY ("name")
);

CREATE TABLE "SentKey" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SentKey_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "SentKey_createdAt_idx" ON "SentKey"("createdAt");

ALTER TABLE "ExtensionHeartbeat" ADD COLUMN "errorCount24h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "errorLogJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN "outboxSize" INTEGER NOT NULL DEFAULT 0;
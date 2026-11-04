-- CreateTable
CREATE TABLE "FbAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "browser" TEXT NOT NULL DEFAULT '',
    "profileLabel" TEXT NOT NULL DEFAULT '',
    "installId" TEXT NOT NULL DEFAULT '',
    "loggedIn" BOOLEAN NOT NULL DEFAULT true,
    "postsCaptured" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FbAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionHeartbeat" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '',
    "browser" TEXT NOT NULL DEFAULT '',
    "profileLabel" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "fbLoggedIn" BOOLEAN NOT NULL DEFAULT false,
    "fbUserId" TEXT,
    "fbUserName" TEXT NOT NULL DEFAULT '',
    "fbCheckedAt" TIMESTAMP(3),
    "tabsJson" TEXT NOT NULL DEFAULT '[]',
    "lastError" TEXT NOT NULL DEFAULT '',
    "lastErrorAt" TIMESTAMP(3),
    "lastPostAt" TIMESTAMP(3),
    "postsSent" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtensionHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FbAccount_lastSeenAt_idx" ON "FbAccount"("lastSeenAt");

-- CreateIndex
CREATE INDEX "ExtensionHeartbeat_lastSeenAt_idx" ON "ExtensionHeartbeat"("lastSeenAt");

-- Supabase: keep the Data API closed (no policies); MY-BOT connects as the table owner.
ALTER TABLE "FbAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExtensionHeartbeat" ENABLE ROW LEVEL SECURITY;

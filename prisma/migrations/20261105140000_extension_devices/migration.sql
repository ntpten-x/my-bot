CREATE TABLE "ExtensionPairingCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtensionPairingCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExtensionPairingCode_codeHash_key" ON "ExtensionPairingCode"("codeHash");

CREATE TABLE "ExtensionDevice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT '',
    "lastSeenAt" TIMESTAMP(3),
    "lastIp" TEXT NOT NULL DEFAULT '',
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtensionDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExtensionDevice_tokenHash_key" ON "ExtensionDevice"("tokenHash");

CREATE TABLE "LoginGuard" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LoginGuard_pkey" PRIMARY KEY ("key")
);
ALTER TABLE "Owner" ADD COLUMN "username" TEXT NOT NULL DEFAULT 'admin';
CREATE UNIQUE INDEX "Owner_username_key" ON "Owner"("username");

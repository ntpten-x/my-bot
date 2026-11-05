-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "boundCategorySlug" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "defaultProductId" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "productBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "productId" TEXT;

-- AlterTable
ALTER TABLE "LabelCorrection" ADD COLUMN     "fromProduct" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "toProduct" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "categorySlug" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_categorySlug_sortOrder_idx" ON "Product"("categorySlug", "sortOrder");

-- CreateIndex
CREATE INDEX "Post_productId_createdAt_idx" ON "Post"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_productBy_idx" ON "Post"("productBy");

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_defaultProductId_fkey" FOREIGN KEY ("defaultProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed products (games + IT); the owner can edit them in settings.
INSERT INTO "Product" ("id", "slug", "name", "nameEn", "categorySlug", "aliases", "sortOrder", "updatedAt") VALUES
('prod_roblox', 'roblox', 'Roblox', 'Roblox', 'games', 'roblox, robux, โรบลอกซ์, โรบล็อก, โรบัค, โรบูด, โรแท้, โรพลัส, โรเรท, เติมโร, โร, blox fruit, บล็อกฟรุต, grow a garden, ติดเวด, เพ็ด, เพ้ด', 0, CURRENT_TIMESTAMP),
('prod_rov', 'rov', 'ROV', 'Arena of Valor', 'games', 'rov, aov, realm of valor, arena of valor, อาร์โอวี, คูปองrov, คูปอง rov', 1, CURRENT_TIMESTAMP),
('prod_free_fire', 'free-fire', 'Free Fire', 'Free Fire', 'games', 'free fire, freefire, ff, ฟีฟาย, ฟรีฟาย, เพชรff, เพชร ff', 2, CURRENT_TIMESTAMP),
('prod_pubg', 'pubg', 'PUBG', 'PUBG Mobile', 'games', 'pubg, พับจี, uc pubg, pubgm', 3, CURRENT_TIMESTAMP),
('prod_mlbb', 'mlbb', 'Mobile Legends', 'Mobile Legends: Bang Bang', 'games', 'mobile legend, mobile legends, mlbb, โมบายเลเจนด์, โมบาย เลเจนด์', 4, CURRENT_TIMESTAMP),
('prod_valorant', 'valorant', 'Valorant', 'Valorant', 'games', 'valorant, valo, วาโล, วาโลแรนท์, vp valorant', 5, CURRENT_TIMESTAMP),
('prod_genshin', 'genshin', 'Genshin Impact', 'Genshin Impact', 'games', 'genshin, เก็นชิน, เกนชิน, genesis crystal', 6, CURRENT_TIMESTAMP),
('prod_seven_knights', 'seven-knights', 'Seven Knights Re:Birth', 'Seven Knights Re:Birth', 'games', 'seven knights, 7 knights, เซเว่นไนท์, เซเว่นไนต์', 7, CURRENT_TIMESTAMP),
('prod_cookie_run', 'cookie-run', 'Cookie Run', 'Cookie Run', 'games', 'cookie run, cookierun, คุกกี้รัน, crumble, cookierun crumble', 8, CURRENT_TIMESTAMP),
('prod_efootball', 'efootball', 'eFootball', 'eFootball', 'games', 'efootball, e football, pes, อีฟุตบอล, วินนิ่ง', 9, CURRENT_TIMESTAMP),
('prod_heartopia', 'heartopia', 'Heartopia', 'Heartopia', 'games', 'heartopia, ฮาร์ทโทเปีย, ฮาร์โทเปีย', 10, CURRENT_TIMESTAMP),
('prod_iphone', 'iphone', 'iPhone', 'iPhone', 'it', 'iphone, ไอโฟน', 11, CURRENT_TIMESTAMP),
('prod_ipad', 'ipad', 'iPad', 'iPad', 'it', 'ipad, ไอแพด', 12, CURRENT_TIMESTAMP),
('prod_android_phone', 'android-phone', 'มือถือ Android', 'Android phone', 'it', 'samsung, ซัมซุง, galaxy, oppo, vivo, xiaomi, redmi, realme, huawei', 13, CURRENT_TIMESTAMP),
('prod_notebook', 'notebook', 'โน้ตบุ๊ก', 'Notebook', 'it', 'notebook, laptop, โน้ตบุ๊ก, โน๊ตบุ๊ค, โน้ตบุ๊ค, macbook, แมคบุ๊ก', 14, CURRENT_TIMESTAMP),
('prod_pc', 'pc', 'คอมพิวเตอร์/การ์ดจอ', 'PC & parts', 'it', 'การ์ดจอ, rtx, gtx, คอมประกอบ, cpu, เมนบอร์ด', 15, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

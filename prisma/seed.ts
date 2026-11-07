import { randomBytes } from "crypto";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();
import { DEFAULT_GROQ_MODEL, resolveGroqModel } from "../src/lib/ai/models";
import { CATEGORY_SEEDS, FORBIDDEN_KEYWORDS, WATCH_KEYWORDS, flattenSeeds } from "../src/lib/pipeline/catalog";
import { prepareLead } from "../src/lib/pipeline/prepare";
import { PRODUCT_SEEDS } from "../src/lib/pipeline/products";
import { DEMO_SOURCE_URL, maskSecret, shouldInsertDemoPosts } from "../src/lib/seed-policy";

const prisma = new PrismaClient();

const DEMO = [
  {
    url: "https://www.facebook.com/groups/mybot-demo/posts/1",
    authorName: "สมชาย",
    text: "ตามหาคนรับเติมเกม freefire ในเชียงใหม่ อยากได้เพชรในเกม สะดวกโอนได้เลย",
    hoursAgo: 2,
  },
  {
    url: "https://www.facebook.com/groups/mybot-demo/posts/2",
    authorName: "ร้านคอม",
    text: "ขายการ์ดจอมือสอง กรุงเทพ สภาพใช้งานเอง มีกล่อง",
    hoursAgo: 5,
  },
  {
    url: "https://www.facebook.com/groups/mybot-demo/posts/3",
    authorName: "มิน",
    text: "รับออกแบบโลโก้ งานฟรีแลนซ์ ส่งไฟล์ให้ภายในสามวัน",
    hoursAgo: 8,
  },
  {
    url: "https://www.facebook.com/groups/mybot-demo/posts/4",
    authorName: "คุณนิด",
    text: "มีห้องเช่าคอนโดใกล้รถไฟฟ้าในนนทบุรี เปิดรับผู้เช่าระยะยาว",
    hoursAgo: 20,
  },
  {
    url: "https://www.facebook.com/groups/mybot-demo/posts/5",
    authorName: "เพจร้าน",
    text: "โปรโมชั่นสั่งซื้อเลย ลดราคา ส่งฟรีทั่วไทย ของแถมทุกออเดอร์",
    hoursAgo: 30,
  },
];

async function main() {
  const rows = [];
  let order = 1;
  for (const category of CATEGORY_SEEDS) {
    const parent = await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, matchWords: category.keywords.join(", "), sortOrder: order },
      create: { slug: category.slug, name: category.name, matchWords: category.keywords.join(", "), sortOrder: order },
    });
    rows.push(parent);
    order += 1;
    for (const child of category.children ?? []) {
      const saved = await prisma.category.upsert({
        where: { slug: child.slug },
        update: { name: child.name, parentId: parent.id, matchWords: child.keywords.join(", "), sortOrder: order },
        create: {
          slug: child.slug,
          name: child.name,
          parentId: parent.id,
          matchWords: child.keywords.join(", "),
          sortOrder: order,
        },
      });
      rows.push(saved);
      order += 1;
    }
  }

  // Level-3 products/games: create missing ones only, never overwrite the owner's edits.
  for (const [index, product] of PRODUCT_SEEDS.entries()) {
    await prisma.product.upsert({
      where: { slug: product.slug },
      update: {},
      create: { slug: product.slug, name: product.name, nameEn: product.nameEn, categorySlug: product.categorySlug, aliases: product.aliases.join(", "), sortOrder: index },
    });
  }

  for (const word of WATCH_KEYWORDS) {
    await prisma.keyword.upsert({
      where: { word_type: { word, type: "watch" } },
      update: {},
      create: { word, type: "watch" },
    });
  }
  for (const word of FORBIDDEN_KEYWORDS) {
    await prisma.keyword.upsert({
      where: { word_type: { word, type: "forbidden" } },
      update: {},
      create: { word, type: "forbidden" },
    });
  }

  const existingToken = await prisma.setting.findUnique({ where: { key: "extension_token" } });
  const token = existingToken?.value || randomBytes(24).toString("hex");
  const defaults: Record<string, string> = {
    ai_provider: "auto",
    ollama_base_url: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
    ollama_model: process.env.OLLAMA_MODEL || "qwen2.5:7b",
    gemini_model: "gemini-2.0-flash",
    groq_model: DEFAULT_GROQ_MODEL,
    fetch_interval_minutes: "10",
    jitter_minutes: "1",
    max_groups_per_cycle: "20",
    scroll_screens: "5",
    max_post_age_hours: "24",
    extension_token: token,
    notify_sound: "true",
  };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
  // Owner policy: keep the ≤24 h ingest window and a deep enough default scroll.
  for (const [key, value] of Object.entries({ max_post_age_hours: "24", scroll_screens: "5" })) {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  const groq = await prisma.setting.findUnique({ where: { key: "groq_model" } });
  if (groq && resolveGroqModel(groq.value) !== groq.value) {
    await prisma.setting.update({ where: { key: "groq_model" }, data: { value: resolveGroqModel(groq.value) } });
  }

  const realSourceCount = await prisma.source.count({ where: { NOT: { url: DEMO_SOURCE_URL } } });
  const existingDemo = await prisma.source.findUnique({ where: { url: DEMO_SOURCE_URL } });
  const demoPostCount = existingDemo ? await prisma.post.count({ where: { sourceId: existingDemo.id } }) : 0;
  const insertDemo = shouldInsertDemoPosts({
    realSourceCount,
    demoExists: Boolean(existingDemo),
    demoEnabled: existingDemo?.enabled ?? false,
    demoPostCount,
  });

  const catalog = flattenSeeds();
  const rules = [
    ...WATCH_KEYWORDS.map((word) => ({ word, type: "watch" as const })),
    ...FORBIDDEN_KEYWORDS.map((word) => ({ word, type: "forbidden" as const })),
  ];
  if (insertDemo) {
  const source = await prisma.source.create({
    data: {
      type: "facebook_group",
      name: "ตัวอย่าง — ลบได้",
      url: DEMO_SOURCE_URL,
      enabled: false,
      intervalMinutes: 10,
    },
  });
  for (const demo of DEMO) {
    const lead = prepareLead(demo, rules, catalog);
    const categoryId = rows.find((row) => row.slug === lead.categorySlug)?.id ?? null;
    const subcategoryId = lead.subcategorySlug ? rows.find((row) => row.slug === lead.subcategorySlug)?.id ?? null : null;
    const data = {
      authorName: demo.authorName,
      text: demo.text,
      normalizedText: lead.normalizedText,
      categoryId,
      subcategoryId,
      intent: lead.intent,
      province: lead.province,
      isAd: lead.isAd,
      keywordHitsJson: JSON.stringify(lead.watch),
      forbiddenHit: lead.forbidden.length > 0,
      suggestedReply: lead.suggestedReply,
    };
    const byHash = await prisma.post.findUnique({ where: { contentHash: lead.hash } });
    if (byHash) continue;
    try {
      await prisma.post.create({
        data: {
          ...data,
          sourceId: source.id,
          externalUrl: lead.url,
          contentHash: lead.hash,
          imagesJson: "[]",
          aiProvider: "rules",
          createdAt: new Date(Date.now() - demo.hoursAgo * 3600 * 1000),
        },
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002") continue;
      throw error;
    }
  }
  }

  console.log(insertDemo ? "ใส่ข้อมูลเริ่มต้นพร้อมประกาศตัวอย่างแล้ว" : "ใส่หมวดและคำเฝ้าดูแล้ว ไม่เพิ่มประกาศตัวอย่าง");
  console.log(`โทเคนส่วนขยาย: ${maskSecret(token)}`);
  console.log("ตัวเต็มอยู่ที่หน้าตั้งค่าเท่านั้น หลังตั้งรหัสผ่านเจ้าของ");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

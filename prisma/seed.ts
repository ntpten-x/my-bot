import { randomBytes } from "crypto";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();
import { DEFAULT_GROQ_MODEL, resolveGroqModel } from "../src/lib/ai/models";
import { CATEGORY_SEEDS, FORBIDDEN_KEYWORDS, WATCH_KEYWORDS, flattenSeeds } from "../src/lib/pipeline/catalog";
import { prepareLead } from "../src/lib/pipeline/prepare";

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
    jitter_minutes: "5",
    max_groups_per_cycle: "3",
    extension_token: token,
    notify_sound: "true",
  };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
  const groq = await prisma.setting.findUnique({ where: { key: "groq_model" } });
  if (groq && resolveGroqModel(groq.value) !== groq.value) {
    await prisma.setting.update({ where: { key: "groq_model" }, data: { value: resolveGroqModel(groq.value) } });
  }

  const source = await prisma.source.upsert({
    where: { url: "https://www.facebook.com/groups/mybot-demo" },
    update: {},
    create: {
      type: "facebook_group",
      name: "ตัวอย่าง — ลบได้",
      url: "https://www.facebook.com/groups/mybot-demo",
      enabled: false,
      intervalMinutes: 10,
    },
  });

  const catalog = flattenSeeds();
  const rules = [
    ...WATCH_KEYWORDS.map((word) => ({ word, type: "watch" as const })),
    ...FORBIDDEN_KEYWORDS.map((word) => ({ word, type: "forbidden" as const })),
  ];
  for (const demo of DEMO) {
    const lead = prepareLead(demo, rules, catalog);
    const categoryId = rows.find((row) => row.slug === lead.categorySlug)?.id ?? null;
    const subcategoryId = lead.subcategorySlug ? rows.find((row) => row.slug === lead.subcategorySlug)?.id ?? null : null;
    const found = await prisma.post.findUnique({ where: { contentHash: lead.hash } });
    if (found) continue;
    await prisma.post.create({
      data: {
        sourceId: source.id,
        externalUrl: lead.url,
        authorName: demo.authorName,
        text: demo.text,
        normalizedText: lead.normalizedText,
        contentHash: lead.hash,
        imagesJson: "[]",
        categoryId,
        subcategoryId,
        intent: lead.intent,
        province: lead.province,
        isAd: lead.isAd,
        keywordHitsJson: JSON.stringify(lead.watch),
        forbiddenHit: lead.forbidden.length > 0,
        suggestedReply: lead.suggestedReply,
        aiProvider: "rules",
        createdAt: new Date(Date.now() - demo.hoursAgo * 3600 * 1000),
      },
    });
  }

  console.log("ใส่ข้อมูลเริ่มต้นแล้ว");
  console.log(`โทเคนส่วนขยาย: ${token}`);
  console.log("เปิดแอป ตั้งรหัสผ่าน แล้วคัดลอกโทเคนนี้ไปวางในส่วนขยายได้จากหน้าตั้งค่า");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

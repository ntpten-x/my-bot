import { PrismaClient } from "@prisma/client";
import { resolveGroqModel } from "../src/lib/ai/models";
import { detectIntent } from "../src/lib/pipeline/intent";
import { contentHash, normalizeText } from "../src/lib/pipeline/normalize";
import "../src/lib/load-env";

const prisma = new PrismaClient();

async function main() {
  const posts = await prisma.post.findMany();
  let updated = 0;
  let conflicts = 0;
  for (const post of posts) {
    const normalizedText = normalizeText(post.text).slice(0, 8000);
    const hash = contentHash(post.text, post.externalUrl);
    const intent = detectIntent(post.text);
    if (normalizedText === post.normalizedText && hash === post.contentHash && intent === post.intent) continue;
    const clash = await prisma.post.findFirst({ where: { contentHash: hash, NOT: { id: post.id } } });
    if (clash) {
      conflicts += 1;
      console.warn(`ข้ามโพสต์ ${post.id} เพราะแฮชใหม่ชนกับ ${clash.id}`);
      continue;
    }
    await prisma.post.update({
      where: { id: post.id },
      data: { normalizedText, contentHash: hash, intent },
    });
    updated += 1;
  }

  const groq = await prisma.setting.findUnique({ where: { key: "groq_model" } });
  if (groq) {
    const next = resolveGroqModel(groq.value);
    if (next !== groq.value) {
      await prisma.setting.update({ where: { key: "groq_model" }, data: { value: next } });
      console.log(`อัปเดตโมเดล Groq จาก ${groq.value} เป็น ${next}`);
    }
  }

  console.log(`ปรับข้อความแล้ว ${updated} โพสต์, ชนแฮช ${conflicts} โพสต์`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

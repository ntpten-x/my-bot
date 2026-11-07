import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { isExtensionSource } from "@/lib/scrape-plan";

export const dynamic = "force-dynamic";

// Coverage audit: the extension scrolls this source deeper (read-only, up to 24 h back) and
// every post it finds that MY-BOT did not have yet is counted as a missed post.
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const source = await prisma.source.findUnique({ where: { id } });
  if (!source) return json({ error: "ไม่พบแหล่งข้อมูล" }, 404);
  if (!isExtensionSource(source.type)) return json({ error: "ตรวจความครบได้เฉพาะกลุ่ม Facebook และ Marketplace" }, 400);
  const pending = await prisma.fetchTask.findFirst({ where: { sourceId: id, mode: "audit", status: { in: ["pending", "picked"] } } });
  if (pending) return json({ queued: true, taskId: pending.id, message: "มีงานตรวจความครบของแหล่งนี้รออยู่แล้ว" });
  const task = await prisma.fetchTask.create({ data: { sourceId: id, status: "pending", mode: "audit" } });
  await prisma.fetchLog.create({
    data: { sourceId: id, status: "queued", message: "สั่งตรวจความครบ (เลื่อนลึกย้อนหลังไม่เกิน 24 ชม. แบบอ่านอย่างเดียว)", postsFound: 0 },
  });
  return json({ queued: true, taskId: task.id, message: "ส่งงานตรวจความครบให้ส่วนขยายแล้ว ใช้เวลาไม่กี่นาที" });
}
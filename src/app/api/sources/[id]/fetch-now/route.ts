import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { ingestPosts } from "@/lib/ingest";
import { fetchRssPosts } from "@/lib/rss";
import { fetchWebBoardPosts } from "@/lib/web-board";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const source = await prisma.source.findUnique({ where: { id } });
  if (!source) return json({ error: "ไม่พบแหล่งข้อมูล" }, 404);
  if (source.type === "facebook_group") {
    const task = await prisma.fetchTask.create({ data: { sourceId: source.id, status: "pending" } });
    await prisma.fetchLog.create({
      data: {
        sourceId: source.id,
        status: "queued",
        message: "สั่งดึงทันทีแล้ว รอส่วนขยายเปิดกลุ่มในรอบถัดไป",
        postsFound: 0,
      },
    });
    return json({ queued: true, taskId: task.id, message: "ส่งคิวให้ส่วนขยายแล้ว จะเปิดกลุ่มนี้ภายในประมาณ 30 วินาที" });
  }
  try {
    const posts = source.type === "rss" ? await fetchRssPosts(source.url) : await fetchWebBoardPosts(source.url);
    const result = await ingestPosts({ sourceUrl: source.url, posts, actor: "worker" });
    return json({ queued: false, message: `ดึงแล้ว ใหม่ ${result.inserted} ซ้ำ ${result.duplicates}`, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ดึงไม่สำเร็จ";
    await prisma.source.update({ where: { id }, data: { lastError: message.slice(0, 500), lastFetchedAt: new Date() } });
    await prisma.fetchLog.create({
      data: { sourceId: id, status: "error", message: message.slice(0, 500), postsFound: 0 },
    });
    return json({ error: message }, 502);
  }
}

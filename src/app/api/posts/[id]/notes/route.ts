import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const parsed = z.object({ body: z.string().min(1).max(2000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "พิมพ์โน้ตก่อนบันทึก" }, 400);
  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) return json({ error: "ไม่พบประกาศ" }, 404);
  const note = await prisma.note.create({ data: { postId: id, body: parsed.data.body.trim() } });
  return json({
    note: { id: note.id, body: note.body, createdAt: note.createdAt.toISOString() },
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  await context.params;
  const noteId = new URL(request.url).searchParams.get("noteId");
  if (!noteId) return json({ error: "ไม่พบโน้ต" }, 400);
  await prisma.note.delete({ where: { id: noteId } }).catch(() => undefined);
  return json({ ok: true });
}

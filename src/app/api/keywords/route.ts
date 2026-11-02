import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const keywords = await prisma.keyword.findMany({ orderBy: { createdAt: "desc" } });
  return json({ keywords });
}

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = z
    .object({ word: z.string().min(1).max(80), type: z.enum(["watch", "forbidden"]) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ระบุคำและประเภท" }, 400);
  try {
    const keyword = await prisma.keyword.create({
      data: { word: parsed.data.word.trim(), type: parsed.data.type },
    });
    return json({ keyword });
  } catch {
    return json({ error: "มีคำนี้อยู่แล้ว" }, 409);
  }
}

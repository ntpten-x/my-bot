import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireExtensionToken } from "@/lib/auth";
import { corsPreflight, json, withCors } from "@/lib/http";
import { findSourceByUrl } from "@/lib/sources";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization")))) {
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  const parsed = z
    .object({
      sourceUrl: z.string().url(),
      status: z.enum(["ok", "error"]),
      message: z.string().max(500).optional(),
      postsFound: z.number().int().optional(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(json({ error: "ข้อมูลไม่ถูกต้อง" }, 400));
  const source = await findSourceByUrl(parsed.data.sourceUrl);
  if (!source) return withCors(json({ error: "ไม่พบแหล่งข้อมูล" }, 404));
  const message = parsed.data.message ?? "";
  await prisma.fetchLog.create({
    data: {
      sourceId: source.id,
      status: parsed.data.status,
      message,
      postsFound: parsed.data.postsFound ?? 0,
    },
  });
  await prisma.source.update({
    where: { id: source.id },
    data: {
      lastFetchedAt: new Date(),
      lastError: parsed.data.status === "error" ? message.slice(0, 500) : null,
    },
  });
  return withCors(json({ ok: true }));
}

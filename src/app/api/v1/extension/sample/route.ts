import { z } from "zod";
import { requireExtensionToken } from "@/lib/auth";
import { saveParseSample, touchExtension } from "@/lib/extension-status";
import { corsPreflight, json, withCors } from "@/lib/http";
import { findSourceByUrl } from "@/lib/sources";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const bodySchema = z.object({
  sourceUrl: z.string().min(1),
  posts: z.array(z.record(z.string(), z.unknown())).max(20),
});

export async function POST(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization")))) {
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(json({ error: "ข้อมูลไม่ถูกต้อง" }, 400));
  await saveParseSample(parsed.data.sourceUrl, parsed.data.posts);
  const source = await findSourceByUrl(parsed.data.sourceUrl).catch(() => null);
  await touchExtension(source?.id);
  return withCors(json({ ok: true, postCount: parsed.data.posts.length }));
}

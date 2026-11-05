import { z } from "zod";
import { requireExtensionToken } from "@/lib/auth";
import { corsPreflight, json, withCors } from "@/lib/http";
import { ingestPosts } from "@/lib/ingest";
import { countCapturedPosts, noteBadExtensionToken } from "@/lib/extension-heartbeat";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sourceUrl: z.string().url(),
  posts: z
    .array(
      z.object({
        url: z.string().url(),
        authorName: z.string().optional(),
        text: z.string().min(1),
        postedAt: z.string().nullable().optional(),
        images: z.array(z.string()).optional(),
      }),
    )
    .max(40),
  fbUserId: z.string().regex(/^\d{5,20}$/).optional(),
});

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization"), request))) {
    await noteBadExtensionToken();
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, 400));
  try {
    const { fbUserId, ...data } = parsed.data;
    const result = await ingestPosts({ ...data, actor: "extension" });
    await countCapturedPosts(fbUserId, result.inserted).catch(() => undefined);
    return withCors(json(result, result.ok ? 200 : 404));
  } catch (error) {
    const message = error instanceof Error ? error.message : "บันทึกไม่สำเร็จ";
    return withCors(json({ error: message }, 500));
  }
}

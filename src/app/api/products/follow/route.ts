import { readJson } from "@/lib/request-body";
import { z } from "zod";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { readFollowedProducts, writeFollowedProducts } from "@/lib/product-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  return json({ ids: await readFollowedProducts() });
}

const schema = z.object({ ids: z.array(z.string().min(1)).max(50) });

/** "หมวดที่คุณติดตาม": followed products, shown as quick links on the feed. */
export async function PUT(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = schema.safeParse(await readJson(request, 1_500_000).catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  return json({ ids: await writeFollowedProducts(parsed.data.ids) });
}

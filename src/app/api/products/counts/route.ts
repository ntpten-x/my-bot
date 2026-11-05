import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Post counts per product for the feed tabs: originals, no ads, not dismissed, last N days (default 30). */
export async function GET(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const params = new URL(request.url).searchParams;
  const days = Math.min(90, Math.max(1, Number(params.get("days")) || 30));
  const categoryId = params.get("categoryId");
  const rows = await prisma.post.groupBy({
    by: ["productId"],
    where: {
      duplicateOfId: null,
      isAd: false,
      dismissed: false,
      createdAt: { gte: new Date(Date.now() - days * 24 * 3600_000) },
      ...(categoryId ? { categoryId } : {}),
    },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.productId ?? "none"] = row._count._all;
  return json({ counts, days });
}

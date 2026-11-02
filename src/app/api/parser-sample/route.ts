import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const rows = await prisma.parseSample.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
  return json({
    samples: rows.map((row) => ({
      id: row.id,
      sourceUrl: row.sourceUrl,
      postCount: row.postCount,
      createdAt: row.createdAt.toISOString(),
      posts: JSON.parse(row.payload) as unknown[],
    })),
  });
}

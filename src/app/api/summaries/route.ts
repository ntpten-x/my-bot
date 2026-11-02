import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const summaries = await prisma.summary.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  return json({
    summaries: summaries.map((row) => ({
      id: row.id,
      day: row.day,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}

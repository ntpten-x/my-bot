import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST() {
  const { error } = await authed();
  if (error) return error;
  const result = await prisma.post.updateMany({ data: { embeddingConfig: "", embeddingRetryAt: new Date() } });
  return json({ queued: result.count });
}

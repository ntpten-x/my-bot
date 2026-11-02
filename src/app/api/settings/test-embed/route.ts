import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { testEmbedding } from "@/lib/smart/embed";

export const dynamic = "force-dynamic";

export async function POST() {
  const { error } = await authed();
  if (error) return error;
  const settings = await getSettings();
  const result = await testEmbedding(settings);
  const missing = await prisma.post.count({ where: { OR: [{ embeddingJson: "" }, { embeddingJson: "[]" }] } });
  return json({ ...result, missing });
}

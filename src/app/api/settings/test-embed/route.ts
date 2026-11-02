import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { testEmbedding } from "@/lib/smart/embed";
import { embeddingConfig } from "@/lib/smart/embedding-key";

export const dynamic = "force-dynamic";

export async function POST() {
  const { error } = await authed();
  if (error) return error;
  const settings = await getSettings();
  const result = await testEmbedding(settings);
  const missing = await prisma.post.count({ where: { OR: [{ embeddingJson: "" }, { embeddingJson: "[]" }, { embeddingConfig: { not: embeddingConfig(settings) } }] } });
  return json({ ...result, missing });
}

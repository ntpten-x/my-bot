import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { retentionPreview } from "@/lib/retention";

export const dynamic = "force-dynamic";

// Dry run: how many rows the next daily retention run would delete. Deletes nothing.
export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const preview = await retentionPreview();
  const last = await prisma.setting.findUnique({ where: { key: "retention_last_result" } });
  let lastRun: unknown = null;
  try {
    lastRun = last?.value ? JSON.parse(last.value) : null;
  } catch {
    lastRun = null;
  }
  return json({ preview, lastRun });
}

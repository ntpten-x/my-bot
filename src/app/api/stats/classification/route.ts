import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { classificationStats } from "@/lib/classification-stats";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  return json({ groups: await classificationStats() });
}

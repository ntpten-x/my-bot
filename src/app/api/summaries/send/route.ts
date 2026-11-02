import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { sendDailySummaryNow } from "@/lib/smart/daily";

export const dynamic = "force-dynamic";

export async function POST() {
  const { error } = await authed();
  if (error) return error;
  const summary = await sendDailySummaryNow();
  return json({
    summary: { id: summary.id, day: summary.day, title: summary.title, body: summary.body },
  });
}

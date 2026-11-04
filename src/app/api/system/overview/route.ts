import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { collectSystemOverview } from "@/lib/system-overview";
import { forget, memo } from "@/lib/memo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  // Plain reloads share one result for 30 s; "fresh=1" (the refresh button) always measures again.
  if (fresh) forget("system-overview");
  return json(await memo("system-overview", 30_000, () => collectSystemOverview({ fresh })));
}

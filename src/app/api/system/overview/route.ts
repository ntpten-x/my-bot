import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { collectSystemOverview } from "@/lib/system-overview";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  return json(await collectSystemOverview({ fresh }));
}

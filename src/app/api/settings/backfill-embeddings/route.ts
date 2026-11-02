import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { backfillEmbeddings } from "@/lib/smart/backfill";

export const dynamic = "force-dynamic";

export async function POST() {
  const { error } = await authed();
  if (error) return error;
  const result = await backfillEmbeddings(30);
  return json(result);
}

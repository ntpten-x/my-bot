import { getSession, ownerExists } from "@/lib/auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const [needsSetup, session] = await Promise.all([ownerExists().then((exists) => !exists), getSession()]);
  return json({ needsSetup, authenticated: Boolean(session) });
}

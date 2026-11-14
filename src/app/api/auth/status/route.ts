import { authRateError } from "@/lib/auth-rate";
import { getSession, ownerExists } from "@/lib/auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rate = authRateError(request); if (rate) return rate;
  const [needsSetup, session] = await Promise.all([ownerExists().then((exists) => !exists), getSession()]);
  const response = json({ needsSetup, authenticated: Boolean(session) });
  response.headers.set("Cache-Control", "no-store"); return response;
}

import { getSession } from "@/lib/auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const response = json({ authenticated: Boolean(session) }, session ? 200 : 401);
  response.headers.set("Cache-Control", "no-store"); return response;
}

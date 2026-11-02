import { getSession } from "@/lib/auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return json({ authenticated: false }, 401);
  return json({ authenticated: true });
}

import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { createPairingCode } from "@/lib/extension-devices";

export const dynamic = "force-dynamic";

export async function POST() {
  const { error } = await authed();
  if (error) return error;
  const { code, expiresAt } = await createPairingCode();
  return json({ code, expiresAt: expiresAt.toISOString() });
}
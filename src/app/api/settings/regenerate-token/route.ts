import { randomBytes } from "crypto";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { getSettings, publicSettings, upsertSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST() {
  const { error } = await authed();
  if (error) return error;
  const token = randomBytes(24).toString("hex");
  await upsertSettings({ extension_token: token });
  return json({ settings: publicSettings(await getSettings()) });
}

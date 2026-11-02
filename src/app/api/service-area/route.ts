import { z } from "zod";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { getSettings, upsertSettings } from "@/lib/settings";
import { PROVINCES } from "@/lib/pipeline/province";
import { parseProvinceList } from "@/lib/service-area";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const settings = await getSettings();
  return json({
    provinces: settings.serviceProvinces,
    notifyOnly: settings.serviceAreaNotifyOnly,
    followUpDays: settings.followUpDays,
    allProvinces: PROVINCES,
  });
}

const putSchema = z.object({
  provinces: z.array(z.string()).max(77).optional(),
  notifyOnly: z.boolean().optional(),
  followUpDays: z.number().int().min(0).max(30).optional(),
});

export async function PUT(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const entries: Record<string, string> = {};
  if (parsed.data.provinces) entries.service_provinces = parseProvinceList(parsed.data.provinces.join(",")).join(",");
  if (parsed.data.notifyOnly !== undefined) entries.service_area_notify_only = String(parsed.data.notifyOnly);
  if (parsed.data.followUpDays !== undefined) entries.follow_up_days = String(parsed.data.followUpDays);
  if (Object.keys(entries).length) await upsertSettings(entries);
  const settings = await getSettings();
  return json({ provinces: settings.serviceProvinces, notifyOnly: settings.serviceAreaNotifyOnly, followUpDays: settings.followUpDays });
}

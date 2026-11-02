import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { dispatchNotification } from "@/lib/notify";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST() {
  const { error } = await authed();
  if (error) return error;
  const settings = await getSettings();
  const result = await dispatchNotification(
    {
      id: null,
      text: "นี่คือตัวอย่างลีดร้อนสำหรับทดสอบ Discord embed",
      externalUrl: "http://localhost:8001/feed",
      intent: "buyer",
      province: "เชียงใหม่",
      category: { name: "เกม" },
      subcategory: { name: "เติมเกม" },
      source: { name: "กลุ่มทดสอบ" },
      score: 88,
      suggestedReply: "สวัสดีครับ มีของตรงตามที่หา สะดวกทักรายละเอียดได้เลย",
    },
    settings,
    "ทดสอบลีดร้อน",
    { external: true, forceExternal: true, discordMode: "embed" },
  );
  return json({ ok: true, channels: result.channels });
}

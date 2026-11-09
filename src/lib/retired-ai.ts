import { authed } from "./guard";
import { json } from "./http";

/** Old clients cannot re-enable model calls or create model jobs. */
export async function retiredAiResponse() {
  const { error } = await authed();
  if (error) return error;
  return json({ error: "ระบบใช้บอทตามกฎแล้ว ฟังก์ชัน AI ถูกนำออก", code: "AI_REMOVED" }, 410);
}

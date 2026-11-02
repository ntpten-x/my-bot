import { z } from "zod";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { testProvider } from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = z.object({ provider: z.enum(["ollama", "gemini", "groq", "rules"]) }).safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return json({ error: "เลือกผู้ให้บริการก่อน" }, 400);
  const result = await testProvider(parsed.data.provider, await getSettings());
  return json(result);
}

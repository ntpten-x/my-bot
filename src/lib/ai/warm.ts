import { OLLAMA_KEEP_ALIVE, resolveOllamaBaseUrl } from "./ollama-url";
import { ollamaEmbedModels } from "../smart/embed";
import { workerLog } from "../log";

export async function warmOllamaModels(settings: { ollamaBaseUrl: string; ollamaModel: string; embedModel: string }) {
  if (process.env.OLLAMA_DISABLED === "1") return;
  const base = await resolveOllamaBaseUrl(settings.ollamaBaseUrl);
  let chat = false;
  try {
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: settings.ollamaModel,
        stream: false,
        keep_alive: OLLAMA_KEEP_ALIVE,
        messages: [{ role: "user", content: "ตอบว่า ok" }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    chat = response.ok;
  } catch {
    chat = false;
  }

  let installed: string[] = [];
  try {
    const tags = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (tags.ok) {
      const data = await tags.json();
      installed = (data.models ?? []).map((model: { name?: string }) => model.name ?? "").filter(Boolean);
    }
  } catch {
    installed = [];
  }
  const embedModel = ollamaEmbedModels(settings.embedModel || "bge-m3", installed)[0] || settings.embedModel || "bge-m3";
  let embed = false;
  try {
    const response = await fetch(`${base}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: embedModel, input: "warm", keep_alive: OLLAMA_KEEP_ALIVE }),
      signal: AbortSignal.timeout(90_000),
    });
    embed = response.ok;
  } catch {
    embed = false;
  }
  await workerLog({
    provider: "ollama",
    level: chat || embed ? "info" : "error",
    message: `warm chat=${chat} embed=${embed} at ${base}`,
    error: chat && embed ? undefined : `chat=${settings.ollamaModel} embed=${embedModel}`,
  });
}

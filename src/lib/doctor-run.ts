import { existsSync, readFileSync } from "node:fs";
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { resolveOllamaBaseUrl } from "./ai/ollama-url";
import { testEmbedding } from "./smart/embed";
import { evaluateDoctor, type DoctorFacts } from "./doctor";

function envFlags() {
  const present = { databaseUrl: false, port: false, groq: false, gemini: false, discord: false };
  if (!existsSync(".env")) return present;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!value) continue;
    if (key === "DATABASE_URL") present.databaseUrl = true;
    if (key === "PORT") present.port = true;
    if (key === "GROQ_API_KEY") present.groq = true;
    if (key === "GEMINI_API_KEY") present.gemini = true;
    if (key === "DISCORD_WEBHOOK_URL") present.discord = true;
  }
  return present;
}

async function portState(port: number): Promise<DoctorFacts["portState"]> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/status`, { signal: AbortSignal.timeout(1500) });
    const data = await response.json().catch(() => null);
    if (data && typeof data.needsSetup === "boolean") return "ours";
    return "busy";
  } catch {
    return "free";
  }
}

export async function collectDoctorReport() {
  const env = envFlags();
  const nodeMajor = Number(process.versions.node.split(".")[0] || 0);
  const depsInstalled = existsSync("node_modules/next/package.json");
  let dbOk = false;
  let extensionToken = false;
  let settings: Awaited<ReturnType<typeof getSettings>> | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.source.count();
    dbOk = true;
    settings = await getSettings();
    extensionToken = Boolean(settings.extensionToken);
  } catch {
    dbOk = false;
  }
  const port = Number(process.env.PORT || 8001);
  const state = await portState(port);
  let ollamaReachable = false;
  let ollamaModels: string[] = [];
  if (settings) {
    try {
      const base = await resolveOllamaBaseUrl(settings.ollamaBaseUrl);
      const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        ollamaReachable = true;
        const data = await response.json();
        ollamaModels = (data.models ?? []).map((model: { name?: string }) => model.name ?? "").filter(Boolean);
      }
    } catch {
      ollamaReachable = false;
    }
  }
  let embedOk = false;
  let embedDetail = "ยังไม่ได้ทดสอบ";
  if (settings && ollamaReachable) {
    const embed = await testEmbedding(settings);
    embedOk = embed.ok;
    embedDetail = embed.message;
  } else if (!ollamaReachable) {
    embedDetail = "ข้ามเพราะต่อ Ollama ไม่ได้";
  }
  let groqReachable: boolean | null = null;
  if (settings?.groqApiKey) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { authorization: `Bearer ${settings.groqApiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      groqReachable = response.ok;
    } catch {
      groqReachable = false;
    }
  }
  let geminiReachable: boolean | null = null;
  if (settings?.geminiApiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(settings.geminiApiKey)}`,
        { signal: AbortSignal.timeout(5000) },
      );
      geminiReachable = response.ok;
    } catch {
      geminiReachable = false;
    }
  }
  const facts: DoctorFacts = {
    nodeMajor,
    depsInstalled,
    env,
    dbOk,
    portState: state,
    ollamaReachable,
    ollamaModels,
    embedOk,
    embedDetail,
    groqReachable,
    geminiReachable,
    extensionToken,
  };
  return { port, checks: evaluateDoctor(facts) };
}

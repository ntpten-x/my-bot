import { existsSync, readFileSync } from "node:fs";
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { resolveOllamaBaseUrl } from "./ai/ollama-url";
import { testEmbedding } from "./smart/embed";
import { evaluateDoctor, type DoctorFacts } from "./doctor";
import { schemaReadiness } from "./schema-readiness";

function envFlags() {
  const fileEnv: Record<string, string> = {};
  const lines = existsSync(".env") ? readFileSync(".env", "utf8").split(/\r?\n/) : [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    fileEnv[key] = value;
  }
  // Render supplies process environment; a .env file is not required there.
  const env = { ...fileEnv, ...process.env };
  const database = env.DATABASE_URL?.trim() || "";
  return {
    databaseUrl: Boolean(database),
    databaseKind: !database ? undefined : /^postgres(ql)?:/.test(database) ? "postgres" : database.startsWith("file:") ? "sqlite" : "other",
    directUrl: Boolean(env.DIRECT_URL?.trim()), port: Boolean(env.PORT?.trim()),
    groq: Boolean(env.GROQ_API_KEY?.trim()), gemini: Boolean(env.GEMINI_API_KEY?.trim()), discord: Boolean(env.DISCORD_WEBHOOK_URL?.trim()),
  } satisfies DoctorFacts["env"];
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
  const checks = evaluateDoctor(facts);
  if (dbOk) {
    try {
      const schema = await schemaReadiness();
      checks.push({ id: "db-schema", status: schema.ready ? "PASS" : "FAIL", label: schema.ready ? "โครงสร้างฐานข้อมูลครบ" : "โครงสร้างฐานข้อมูลยังไม่ครบ", hint: schema.ready ? "" : `ขาด ${schema.missing.join(", ")} — ต้องรัน migration บนเซิร์ฟเวอร์หลังตรวจปลายทางและ backup` });
    } catch { checks.push({ id: "db-schema", status: "FAIL", label: "ตรวจโครงสร้างฐานข้อมูลไม่สำเร็จ", hint: "ตรวจสิทธิ์ฐานข้อมูลและ migration" }); }
  }
  return { port, checks };
}

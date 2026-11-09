// Isolated, synthetic UI server. Never uses the owner's database or starts a worker.
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { PrismaClient } from "@prisma/client";
import path from "node:path";

const base = new URL(process.env.TEST_DATABASE_URL || "postgresql://invalid");
if (base.hostname !== "127.0.0.1" || base.port !== "55439") throw new Error("Use the isolated local test cluster on port 55439 only");
const schema = `test_rules_ui_${randomUUID().replaceAll("-", "")}`;
base.searchParams.set("schema", schema);
const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(env, { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: base.toString(), DIRECT_URL: base.toString(),
  AI_KEY_SECRET: "synthetic-ui-only-not-a-production-key", GROQ_API_KEY: "", GEMINI_API_KEY: "", DISCORD_WEBHOOK_URL: "",
  LINE_CHANNEL_ACCESS_TOKEN: "", LINE_USER_ID: "", SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", NOTIFY_EMAIL_TO: "" });
const db = new PrismaClient({ datasourceUrl: base.toString() });
let child;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill();
    await exited;
  }
  if (!/^test_rules_ui_[a-f0-9]+$/.test(schema)) throw new Error("Unsafe test schema");
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.$disconnect();
  process.stdin.pause();
}
try {
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env, stdio: "pipe" });
  // Test legacy settings too: they must never reactivate model calls.
  await db.setting.create({ data: { key: "ai_provider", value: "auto" } });
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  child = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: "ignore", windowsHide: true });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline && child.exitCode === null) {
    try { ready = (await fetch(`${origin}/api/auth/status`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* startup */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Synthetic server startup failed");
  console.log(`SYNTHETIC_UI_ORIGIN=${origin}`);
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", data => { if (data.trim() === "stop") void stop(); });
  await new Promise(resolve => child.once("exit", resolve));
  await stop();
} catch {
  await stop();
  console.error("Isolated UI test failed (environment values withheld)");
  process.exitCode = 1;
}

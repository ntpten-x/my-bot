import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";

// Deliberately refuses any database outside the dedicated local test cluster.
// No .env is loaded, and no real API/notification keys are inherited by children.
const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const { PrismaClient } = require("@prisma/client");
let base;
try { base = new URL(process.env.TEST_DATABASE_URL || "postgresql://invalid"); }
catch { throw new Error("Invalid test database URL (value hidden)"); }
if (base.hostname !== "127.0.0.1" || base.port !== "55432" || process.platform === "win32") {
  throw new Error("Use the isolated Linux/WSL Postgres test cluster at 127.0.0.1:55432 only");
}
if (!existsSync(path.join(root, ".next/BUILD_ID"))) throw new Error("Run npm run build first");
const schema = `test_smoke_${randomUUID().replaceAll("-", "")}`;
base.searchParams.set("schema", schema);
base.searchParams.delete("pgbouncer");
const runtime = mkdtempSync(path.join(tmpdir(), "mybot-production-smoke-"));
const environment = Object.fromEntries(["PATH", "HOME", "TMPDIR"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(environment, {
  NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", OLLAMA_DISABLED: "1",
  AI_KEY_SECRET: "synthetic-smoke-only-not-a-production-key",
  DATABASE_URL: base.toString(), DIRECT_URL: base.toString(),
});
const db = new PrismaClient({ datasourceUrl: base.toString() });
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  const deadline = Date.now() + 15_000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(100);
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}
function run(args, extra = {}) {
  const child = spawn(process.execPath, args, { cwd: runtime, env: { ...environment, ...extra }, stdio: "ignore", detached: true });
  children.push(child);
  return child;
}

try {
  for (const name of ["node_modules", ".next", "public"]) symlinkSync(path.join(root, name), path.join(runtime, name), "dir");
  for (const name of ["package.json", "next.config.ts", "tsconfig.json", "prisma"]) cpSync(path.join(root, name), path.join(runtime, name), { recursive: true });
  execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(runtime, "prisma/schema.prisma")], { cwd: runtime, env: environment, stdio: "pipe" });
  execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-f", path.join(root, "scripts/sql/verify-security-stability.sql")], {
    cwd: runtime, stdio: "pipe", env: {
      ...environment, PGHOST: "127.0.0.1", PGPORT: "55432", PGDATABASE: decodeURIComponent(base.pathname.slice(1)),
      PGUSER: decodeURIComponent(base.username), PGPASSWORD: decodeURIComponent(base.password), PGOPTIONS: `-c search_path=${schema}`,
    },
  });
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  run([path.join(root, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)]);
  run([path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "src/worker/index.ts")], { MYBOT_PROCESS: "worker" });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 35_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (children.some(child => child.exitCode !== null)) throw new Error("A production test process exited during startup");
    try {
      const response = await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
      const tick = await db.setting.findUnique({ where: { key: "worker_last_tick" } });
      if (response.ok && tick) { healthy = true; break; }
    } catch { /* Wait only for our own isolated processes to start. */ }
    await delay(250);
  }
  if (!healthy) throw new Error("Production web/worker smoke startup timed out");
  for (const endpoint of ["/api/posts", "/api/settings", "/api/auto-comment"]) {
    const response = await fetch(`${origin}${endpoint}`);
    if (response.status !== 401) throw new Error("Unauthenticated API access was not denied");
  }
  const commentChange = await fetch(`${origin}/api/auto-comment`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }) });
  if (commentChange.status !== 401 || await db.autoCommentJob.count() !== 0) throw new Error("Auto Comment did not stay off for an unauthenticated request");
  console.log("PASS Auto Comment API denies unauthenticated mutation and default worker creates no comment jobs");
  const publicHealth = await (await fetch(`${origin}/api/v1/health`)).json();
  if (Object.keys(publicHealth).sort().join(",") !== "ok,version" || !publicHealth.ok) throw new Error("Unexpected public health surface");
  const detailed = await fetch(`${origin}/health`);
  if (detailed.status !== 200 || (await detailed.json()).checks.db.ok !== true) throw new Error("Local readiness health failed");
  console.log("PASS production Web/Worker startup; local DB connectivity and worker heartbeat");
  console.log("PASS unauthenticated APIs denied; public health exposes only ok/version");
  console.log("PASS read-only migration verification SQL on the disposable schema");
} catch {
  console.error("FAIL isolated production smoke (details withheld to avoid printing environment values)");
  process.exitCode = 1;
} finally {
  await Promise.all(children.map(child => stop(child)));
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.$disconnect();
  rmSync(runtime, { recursive: true, force: true });
}

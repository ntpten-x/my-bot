import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { childEnvironment } from "./runtime-env.mjs";

function loadEnv() {
  if (!existsSync(".env")) return;
  const text = readFileSync(".env", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();

const prod = process.argv.includes("--prod");
const port = process.env.PORT || "8001";
const node = process.execPath;
const children = [];
let stopping = false;
const restartDelay = new Map();

// Every console line gets a Bangkok timestamp, e.g. "2026-11-04 15:50:07 [worker] ...".
export function stamp(date = new Date()) {
  const local = new Date(date.getTime() + 7 * 3600_000).toISOString();
  return `${local.slice(0, 10)} ${local.slice(11, 19)}`;
}

function pipeLines(stream, target) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) target.write(`${stamp()} ${line}\n`);
  });
  stream.on("end", () => {
    if (buffer) target.write(`${stamp()} ${buffer}\n`);
  });
}

for (const level of ["log", "error", "warn"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => original(stamp(), ...args);
}

function run(args, extraEnv = {}) {
  const child = spawn(node, args, {
    stdio: ["inherit", "pipe", "pipe"],
    env: childEnvironment(process.env, prod, extraEnv),
    shell: false,
    windowsHide: true,
  });
  pipeLines(child.stdout, process.stdout);
  pipeLines(child.stderr, process.stderr);
  children.push(child);
  const startedAt = Date.now();
  child.on("exit", (code, signal) => {
    children.splice(children.indexOf(child), 1);
    if (stopping) return;
    console.error(`[start-all] กระบวนการจบ (รหัส ${code ?? signal}): ${args.join(" ")}`);
    // Keep the system up: restart a crashed child with backoff (reset after a healthy minute).
    const key = args.join(" ");
    const delay = Date.now() - startedAt > 60_000 ? 3000 : Math.min(60_000, (restartDelay.get(key) || 3000) * 2);
    restartDelay.set(key, delay);
    console.error(`[start-all] เริ่มใหม่ใน ${Math.round(delay / 1000)} วินาที`);
    setTimeout(() => { if (!stopping) run(args, extraEnv); }, delay);
  });
  return child;
}

if (prod) run(["node_modules/next/dist/bin/next", "start", "-p", port]);
else run(["node_modules/next/dist/bin/next", "dev", "-p", port]);
run(["node_modules/tsx/dist/cli.mjs", "src/worker/index.ts"], { MYBOT_PROCESS: "worker" });

function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  // Let the worker release its lease and disconnect, then exit anyway.
  const deadline = Date.now() + 12_000;
  const wait = setInterval(() => {
    if (!children.length || Date.now() > deadline) {
      clearInterval(wait);
      for (const child of children) child.kill("SIGKILL");
      process.exit(0);
    }
  }, 200);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
console.log(`[start-all] เว็บพอร์ต ${port} และ worker กำลังเริ่ม`);

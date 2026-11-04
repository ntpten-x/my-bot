import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

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
    env: { ...process.env, ...extraEnv },
    shell: false,
    windowsHide: true,
  });
  pipeLines(child.stdout, process.stdout);
  pipeLines(child.stderr, process.stderr);
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[start-all] กระบวนการจบด้วยรหัส ${code}: ${args.join(" ")}`);
    }
  });
  return child;
}

if (prod) run(["node_modules/next/dist/bin/next", "start", "-p", port]);
else run(["node_modules/next/dist/bin/next", "dev", "-p", port]);
run(["node_modules/tsx/dist/cli.mjs", "src/worker/index.ts"], { MYBOT_PROCESS: "worker" });

function shutdown() {
  for (const child of children) child.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
console.log(`[start-all] เว็บพอร์ต ${port} และ worker กำลังเริ่ม`);

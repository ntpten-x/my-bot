import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type WorkerLog = {
  level?: "info" | "error";
  message: string;
  jobId?: string;
  postId?: string;
  provider?: string;
  latencyMs?: number;
  error?: string;
};

export function workerLogPath() {
  return path.resolve("data", "mybot.log");
}

export async function workerLog(entry: WorkerLog) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level: entry.level ?? "info",
    message: entry.message,
    jobId: entry.jobId,
    postId: entry.postId,
    provider: entry.provider,
    latencyMs: entry.latencyMs,
    error: entry.error,
  });
  const file = workerLogPath();
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${line}\n`, "utf8");
  const printable = entry.level === "error" ? console.error : console.log;
  printable(`[worker] ${entry.message}${entry.provider ? ` provider=${entry.provider}` : ""}${entry.latencyMs != null ? ` ${entry.latencyMs}ms` : ""}${entry.error ? ` ${entry.error}` : ""}`);
}

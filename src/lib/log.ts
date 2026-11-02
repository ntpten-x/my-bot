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

function consoleLine(entry: WorkerLog) {
  const printable = entry.level === "error" ? console.error : console.log;
  printable(
    `[worker] ${entry.message}${entry.provider ? ` provider=${entry.provider}` : ""}${entry.latencyMs != null ? ` ${entry.latencyMs}ms` : ""}${entry.error ? ` ${entry.error}` : ""}`,
  );
}

export async function persistWorkerLine(line: string, write: (file: string, line: string) => Promise<void> = async (file, text) => {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, text, "utf8");
}) {
  try {
    await write(workerLogPath(), line.endsWith("\n") ? line : `${line}\n`);
    return true;
  } catch (error) {
    try {
      console.error("[worker] เขียน log ไม่ได้", error instanceof Error ? error.message : error);
    } catch {
      // console itself can fail when the launcher locks the stream
    }
    return false;
  }
}

export async function workerLog(entry: WorkerLog) {
  try {
    consoleLine(entry);
  } catch {
    // ignore a broken console stream
  }
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
  await persistWorkerLine(line);
}

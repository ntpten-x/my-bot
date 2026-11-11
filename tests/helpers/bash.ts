import { existsSync } from "node:fs";
import path from "node:path";

// Windows' system32/bash.exe is WSL: it cannot consume native temporary paths
// or the fake executable PATH used by these tests. Use Git Bash for native tests.
function resolveTestBash(): string {
  if (process.platform !== "win32") return "bash";
  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
    path.join(process.env.LOCALAPPDATA || "", "hermes", "git", "bin", "bash.exe"),
    path.join(process.env.LOCALAPPDATA || "", "hermes", "git", "usr", "bin", "bash.exe"),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) || candidates[0];
}

export const testBash = resolveTestBash();

export function bashTestPath(value: string) {
  if (process.platform !== "win32") return value;
  if (!existsSync(testBash)) throw new Error("Install Git Bash to run native Windows shell tests");
  return value.replace(/\\/g, "/").replace(/^([A-Za-z]):\//, (_, drive: string) => `/${drive.toLowerCase()}/`);
}

import { existsSync } from "node:fs";
import path from "node:path";

// Windows' system32/bash.exe is WSL: it cannot consume native temporary paths
// or the fake executable PATH used by these tests. Use Git Bash for native tests.
export const testBash = process.platform === "win32"
  ? path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe")
  : "bash";

export function bashTestPath(value: string) {
  if (process.platform !== "win32") return value;
  if (!existsSync(testBash)) throw new Error("Install Git Bash to run native Windows shell tests");
  return value.replace(/\\/g, "/").replace(/^([A-Za-z]):\//, (_, drive: string) => `/${drive.toLowerCase()}/`);
}

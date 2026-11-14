import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { serverSecret } from "../../src/lib/server-secret";
afterEach(() => vi.unstubAllEnvs());
it("accepts private agent-mounted secret files and rejects symlinks or broad permissions", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mybot-secret-fixture-"));
  try {
    vi.stubEnv("SECRET_STORE_DIRECTORY", dir);
    const file = path.join(dir, "AI_KEY_SECRET"); writeFileSync(file, "synthetic-key-from-agent", { mode: 0o600 });
    expect(serverSecret("AI_KEY_SECRET")).toBe("synthetic-key-from-agent");
    if (process.platform !== "win32") {
      chmodSync(file, 0o644); expect(() => serverSecret("AI_KEY_SECRET")).toThrow();
      chmodSync(file, 0o600); symlinkSync(file, path.join(dir, "SECURITY_AUDIT_KEY")); expect(() => serverSecret("SECURITY_AUDIT_KEY")).toThrow();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

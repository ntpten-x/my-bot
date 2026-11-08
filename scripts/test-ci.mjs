import { spawn } from "node:child_process";

// CI must fail instead of silently skipping database suites.
let valid = false;
try { valid = ["postgres:", "postgresql:"].includes(new URL(process.env.TEST_DATABASE_URL || "").protocol); } catch { /* Values are intentionally not logged. */ }
if (!valid) {
  console.error("FAIL: TEST_DATABASE_URL must explicitly name a dedicated test database (value hidden)");
  process.exitCode = 1;
} else {
  // Prisma migrations share a database-wide advisory lock even for different test schemas.
  // Bound parallel suites so Windows/remote Postgres do not exhaust its 10-second lock wait.
  const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=4"], {
    stdio: "inherit", env: { ...process.env, MYBOT_REQUIRE_TEST_DB: "1" },
  });
  child.on("error", () => { console.error("FAIL: test runner could not start"); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
}

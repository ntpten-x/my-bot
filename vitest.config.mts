import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Next keeps JSX for SWC; tests transform it so dashboard regressions execute.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // DB suites talk to a remote Postgres (Supabase), so allow for network latency.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Tests mock Ollama; ignore a local .env that turns it off.
    env: { OLLAMA_DISABLED: "" },
  },
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src"),
    },
  },
});

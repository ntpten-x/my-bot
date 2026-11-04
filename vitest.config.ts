import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // DB suites talk to a remote Postgres (Supabase), so allow for network latency.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});

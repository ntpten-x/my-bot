/** Fail fast on a production server that cannot decrypt stored AI keys. */
import { assertProductionConfig } from "./lib/production-config";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && typeof process.on === "function") {
    // Keep the web server up: log stray async errors instead of crashing the process.
    process.on("unhandledRejection", (error) => {
      console.error(`[web] unhandledRejection: ${error instanceof Error ? error.stack || error.message : String(error)}`.slice(0, 1200));
    });
  }
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  assertProductionConfig();
}

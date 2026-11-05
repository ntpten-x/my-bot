/** Fail fast on a production server that cannot decrypt stored AI keys. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && typeof process.on === "function") {
    // Keep the web server up: log stray async errors instead of crashing the process.
    process.on("unhandledRejection", (error) => {
      console.error(`[web] unhandledRejection: ${error instanceof Error ? error.stack || error.message : String(error)}`.slice(0, 1200));
    });
  }
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!process.env.AI_KEY_SECRET?.trim()) {
    throw new Error(
      "AI_KEY_SECRET is required in production (it encrypts the AI API keys stored in the database). " +
        "Set it in your host's environment (Render → Environment) to the same value used before, then restart.",
    );
  }
}
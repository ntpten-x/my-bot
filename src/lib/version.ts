import packageJson from "../../package.json";

export const APP_VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

export function publicHealth() {
  return { ok: true as const, version: APP_VERSION };
}

import { DESKTOP_VERSION } from "./desktop-version";
import extensionManifest from "../../extension/manifest.json";

export function publicBuildHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const headers: Record<string, string> = {
    "X-MYBOT-Desktop-Version": DESKTOP_VERSION,
    "X-MYBOT-Extension-Version": extensionManifest.version,
    "Cache-Control": "no-store",
  };
  const commit = env.RENDER_GIT_COMMIT;
  if (commit && /^[a-f0-9]{40}$/i.test(commit)) headers["X-MYBOT-Commit"] = commit.slice(0, 12).toLowerCase();
  return headers;
}

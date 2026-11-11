// The Chrome extension shipped with this build: version from its manifest, zip built on demand (cached).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import manifest from "../../extension/manifest.json";
import { createZip, type ZipEntry } from "./zip";
import { isLocalNetworkHost } from "./request-security";

export const EXTENSION_VERSION: string = manifest.version;

const SKIP = new Set(["fixtures", "node_modules", ".DS_Store"]);

export function extensionFiles(root = path.join(process.cwd(), "extension"), apiBase?: string): ZipEntry[] {
  const out: ZipEntry[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (SKIP.has(name) || name.endsWith(".test.js")) continue;
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, rel);
      else out.push({ name: `mybot-extension/${rel}`, data: readFileSync(full) });
    }
  };
  walk(root, "");
  if (apiBase) {
    const url = new URL(apiBase);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || !(url.protocol === "https:" || (url.protocol === "http:" && isLocalNetworkHost(url.host)))) throw new Error("Invalid extension server origin");
    const pattern = `${url.origin}/*`;
    const installConfig = url.protocol === "http:" && isLocalNetworkHost(url.host)
      ? { apiBase: url.origin, localApiBases: [url.origin] }
      : { apiBase: url.origin };
    for (const entry of out) {
      if (entry.name === "mybot-extension/install-config.json") entry.data = Buffer.from(JSON.stringify(installConfig));
      if (entry.name === "mybot-extension/manifest.json") {
        const configured = JSON.parse(entry.data.toString());
        configured.host_permissions = [...new Set([...configured.host_permissions, pattern])];
        const bridge = configured.content_scripts.find((script: { js: string[] }) => script.js.includes("bridge.js"));
        bridge.matches = [...new Set([...bridge.matches, pattern])];
        entry.data = Buffer.from(JSON.stringify(configured, null, 2));
      }
    }
  }
  return out;
}

let cached: Buffer | null = null;
let cachedOrigin: string | undefined;

export function extensionZip(apiBase?: string) {
  if (!cached || cachedOrigin !== apiBase) {
    cached = createZip(extensionFiles(undefined, apiBase));
    cachedOrigin = apiBase;
  }
  return cached;
}

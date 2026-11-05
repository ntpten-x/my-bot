// The Chrome extension shipped with this build: version from its manifest, zip built on demand (cached).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import manifest from "../../extension/manifest.json";
import { createZip, type ZipEntry } from "./zip";

export const EXTENSION_VERSION: string = manifest.version;

const SKIP = new Set(["fixtures", "node_modules", ".DS_Store"]);

export function extensionFiles(root = path.join(process.cwd(), "extension")): ZipEntry[] {
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
  return out;
}

let cached: Buffer | null = null;

export function extensionZip() {
  if (!cached) cached = createZip(extensionFiles());
  return cached;
}
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extensionFiles, EXTENSION_VERSION } from "./extension-package";
import { createZip, type ZipEntry } from "./zip";

export const DESKTOP_VERSION = "0.1.1-preview";
const RUNTIME_FILES = [
  "scripts/start-workstation.mjs", "scripts/start-workstation.sh",
  "scripts/start-bot-desktop.mjs", "scripts/start-bot-desktop.sh", "scripts/store-vnc-password.py",
  "scripts/lib/workstation.mjs", "scripts/lib/workstation-service.mjs", "scripts/lib/bot-desktop.mjs",
  "scripts/lib/bot-browser.mjs", "scripts/lib/browser-profile.mjs",
  "scripts/windows/set-bot-viewer-password.ps1",
];
const INSTALL_FILES = ["Install.cmd", "Install.ps1", "Control.ps1", "ports.ps1", "provision.sh", "control.sh", "rootfs.json", "strings.th.json", "README.th.md"];
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");

export function desktopFiles(serverOrigin: string, root = process.cwd()): ZipEntry[] {
  const url = new URL(serverOrigin);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Desktop requires a public HTTPS server origin");
  const entries: ZipEntry[] = [];
  for (const file of INSTALL_FILES) entries.push({ name: file, data: readFileSync(path.join(root, "desktop", file)) });
  for (const file of RUNTIME_FILES) entries.push({ name: `runtime/${file}`, data: readFileSync(path.join(root, file)) });
  for (const entry of extensionFiles(path.join(root, "extension"), url.origin)) entries.push({ ...entry, name: entry.name.replace(/^mybot-extension\//, "runtime/extension/") });
  const manifestEntry = entries.find(entry => entry.name === "runtime/extension/manifest.json")!;
  const manifest = JSON.parse(manifestEntry.data.toString());
  manifest.host_permissions = manifest.host_permissions.filter((host: string) => /^https:\/\/(www\.|web\.)?facebook\.com\/\*$/.test(host) || host === `${url.origin}/*`);
  for (const script of manifest.content_scripts) if (script.js.includes("bridge.js")) script.matches = [`${url.origin}/*`];
  manifest.key = readFileSync(path.join(root, "desktop/extension-key.txt"), "utf8").trim();
  manifestEntry.data = Buffer.from(JSON.stringify(manifest, null, 2));
  for (const file of ["control.sh", "keepalive.sh", "strings.th.json"]) entries.push({ name: `runtime/desktop/${file}`, data: readFileSync(path.join(root, "desktop", file)) });
  entries.push({ name: "runtime/extension/desktop-config.json", data: Buffer.from(JSON.stringify({ dedicatedReaderDesktop: true })) });
  const files = entries.map(entry => ({ path: entry.name, sha256: digest(entry.data) }));
  const releaseId = digest(Buffer.from(JSON.stringify({ serverOrigin: url.origin, files }))).slice(0, 24);
  entries.push({ name: "package.json", data: Buffer.from(JSON.stringify({ format: 1, name: "MY-BOT Desktop", version: DESKTOP_VERSION,
    extensionVersion: EXTENSION_VERSION, releaseId, serverOrigin: url.origin, files }, null, 2)) });
  return entries;
}

export function desktopZip(serverOrigin: string) { return createZip(desktopFiles(serverOrigin)); }

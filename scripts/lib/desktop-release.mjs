import fs from "node:fs";
import path from "node:path";

/** Complete marker written only after a full runtime tree is copied into staging. */
export const RELEASE_COMPLETE = ".mybot-release-complete";

function resolveRelease(releasesDir, releaseId) {
  if (!/^[a-f0-9]{24}$/.test(String(releaseId || ""))) throw new Error("Invalid release id");
  return path.resolve(releasesDir, releaseId);
}

/**
 * Copy runtime into an immutable release directory atomically.
 * Incomplete trees from a crashed install are deleted and rebuilt.
 */
export function installDesktopRelease({ bundleRuntime, releasesDir, releaseId }) {
  const release = resolveRelease(releasesDir, releaseId);
  const completeMarker = path.join(release, RELEASE_COMPLETE);
  if (fs.existsSync(completeMarker)) return { release, reused: true };

  fs.mkdirSync(releasesDir, { recursive: true });
  fs.rmSync(release, { recursive: true, force: true });
  const staging = `${release}.staging.${process.pid}.${Date.now()}`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    fs.cpSync(bundleRuntime, staging, { recursive: true });
    if (!fs.existsSync(path.join(staging, "scripts", "start-workstation.mjs"))) {
      throw new Error("Incomplete desktop runtime tree");
    }
    fs.writeFileSync(path.join(staging, RELEASE_COMPLETE), `${releaseId}\n`, { mode: 0o644 });
    fs.renameSync(staging, release);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(release, { recursive: true, force: true });
    throw error;
  }
  return { release, reused: false };
}

/** Point /opt/.../current at a completed release via temp symlink + rename. */
export function switchDesktopCurrent(currentLink, releasePath) {
  const resolved = path.resolve(releasePath);
  if (!fs.existsSync(path.join(resolved, RELEASE_COMPLETE))) throw new Error("Release is incomplete");
  const parent = path.dirname(path.resolve(currentLink));
  fs.mkdirSync(parent, { recursive: true });
  const temporary = `${currentLink}.next`;
  try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  fs.symlinkSync(resolved, temporary);
  fs.renameSync(temporary, currentLink);
  return resolved;
}

/** Keep current + previous completed releases; drop incomplete and older trees. */
export function pruneDesktopReleases(releasesDir, keepPaths) {
  const keep = new Set([...keepPaths].filter(Boolean).map((target) => path.resolve(target)));
  if (!fs.existsSync(releasesDir)) return [];
  const removed = [];
  for (const entry of fs.readdirSync(releasesDir)) {
    const target = path.resolve(releasesDir, entry);
    if (keep.has(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(target);
  }
  return removed;
}

export function listCompletedReleases(releasesDir) {
  if (!fs.existsSync(releasesDir)) return [];
  return fs.readdirSync(releasesDir)
    .map((entry) => path.resolve(releasesDir, entry))
    .filter((target) => fs.existsSync(path.join(target, RELEASE_COMPLETE)))
    .sort();
}

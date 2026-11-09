import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { expect, it } from "vitest";

const posixOnly = process.platform === "win32" ? it.skip : it;

const require = createRequire(import.meta.url);
const {
  installDesktopRelease,
  switchDesktopCurrent,
  pruneDesktopReleases,
  listCompletedReleases,
  RELEASE_COMPLETE,
} = require("../../scripts/lib/desktop-release.mjs");

it("stages a release then renames, and rebuilds incomplete trees", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "mybot-desktop-release-"));
  try {
    const runtime = path.join(root, "runtime");
    mkdirSync(path.join(runtime, "scripts"), { recursive: true });
    writeFileSync(path.join(runtime, "scripts", "start-workstation.mjs"), "export {}\n");
    const releasesDir = path.join(root, "releases");
    const releaseId = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const first = installDesktopRelease({ bundleRuntime: runtime, releasesDir, releaseId });
    expect(first.reused).toBe(false);
    expect(existsSync(path.join(first.release, RELEASE_COMPLETE))).toBe(true);
    const again = installDesktopRelease({ bundleRuntime: runtime, releasesDir, releaseId });
    expect(again.reused).toBe(true);

    const brokenId = "bbbbbbbbbbbbbbbbbbbbbbbb";
    const broken = path.join(releasesDir, brokenId);
    mkdirSync(broken, { recursive: true });
    writeFileSync(path.join(broken, "partial.txt"), "incomplete");
    const rebuilt = installDesktopRelease({ bundleRuntime: runtime, releasesDir, releaseId: brokenId });
    expect(rebuilt.reused).toBe(false);
    expect(existsSync(path.join(rebuilt.release, "partial.txt"))).toBe(false);
    expect(readFileSync(path.join(rebuilt.release, RELEASE_COMPLETE), "utf8").trim()).toBe(brokenId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

posixOnly("switches current atomically and prunes incomplete releases", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "mybot-desktop-current-"));
  try {
    const releasesDir = path.join(root, "releases");
    const runtime = path.join(root, "runtime");
    mkdirSync(path.join(runtime, "scripts"), { recursive: true });
    writeFileSync(path.join(runtime, "scripts", "start-workstation.mjs"), "export {}\n");
    const a = installDesktopRelease({ bundleRuntime: runtime, releasesDir, releaseId: "aaaaaaaaaaaaaaaaaaaaaaaa" }).release;
    const b = installDesktopRelease({ bundleRuntime: runtime, releasesDir, releaseId: "bbbbbbbbbbbbbbbbbbbbbbbb" }).release;
    mkdirSync(path.join(releasesDir, "ccccccccincompleteeeeeeee"), { recursive: true });
    const current = path.join(root, "current");
    switchDesktopCurrent(current, a);
    expect(path.resolve(readlinkSync(current))).toBe(path.resolve(a));
    switchDesktopCurrent(current, b);
    expect(path.resolve(readlinkSync(current))).toBe(path.resolve(b));
    pruneDesktopReleases(releasesDir, [b, a]);
    expect(listCompletedReleases(releasesDir).sort()).toEqual([path.resolve(a), path.resolve(b)].sort());
    expect(existsSync(path.join(releasesDir, "ccccccccincompleteeeeeeee"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

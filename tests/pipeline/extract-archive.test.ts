import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { bashTestPath, testBash } from "../helpers/bash";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

it("ships a non-interactive zip extractor for PCManFM Extract Here", () => {
  expect(readFileSync("desktop/extract-archive.sh", "utf8")).toContain("unzip -o");
  expect(readFileSync("desktop/archiver-shim.sh", "utf8")).toContain("extract-archive.sh");
  expect(readFileSync("desktop/libfm.conf", "utf8")).toMatch(/archiver=xarchiver/);
});

it("extracts a zip into the destination directory", () => {
  const parent = path.resolve("data/test-screens");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, "extract-"));
  const zip = path.join(root, "sample.zip");
  const out = path.join(root, "out");
  mkdirSync(out);
  const payload = Buffer.from("hello-bot", "utf8");
  const name = Buffer.from("hello.txt", "utf8");
  const crc = crc32(payload);
  const localHeader = Buffer.alloc(30 + name.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(payload.length, 18);
  localHeader.writeUInt32LE(payload.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28);
  name.copy(localHeader, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localHeader.length + payload.length, 16);
  end.writeUInt16LE(0, 20);
  writeFileSync(zip, Buffer.concat([localHeader, payload, central, end]));
  execFileSync(testBash, [bashTestPath(path.resolve("desktop/extract-archive.sh")), "--extract-to", bashTestPath(out), bashTestPath(zip)], { stdio: "pipe" });
  expect(existsSync(path.join(out, "hello.txt"))).toBe(true);
  expect(readFileSync(path.join(out, "hello.txt"), "utf8")).toBe("hello-bot");
  if (path.dirname(path.resolve(root)) !== parent) throw new Error("Unsafe extract test cleanup");
  rmSync(root, { recursive: true, force: true });
});

import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { backupCipher, decodeBackup } from "../../src/lib/backup-crypto";
import { allowedImageUrl, publicAddress } from "../../src/lib/image-download";
import { validatedDraft } from "../../src/lib/auto-comment/draft";
import { redactLog } from "../../src/lib/log";

describe("untrusted image boundaries", () => {
  it.each(["127.0.0.1", "169.254.169.254", "10.0.0.1", "172.16.1.1", "192.168.1.1", "::1", "::ffff:127.0.0.1", "fc00::1"])("rejects private address %s", ip => expect(publicAddress(ip)).toBe(false));
  it("requires an allowlisted HTTPS origin", () => {
    expect(allowedImageUrl("https://scontent.fbcdn.net/image.jpg")).toBe(true);
    expect(allowedImageUrl("https://fbcdn.net.evil.test/image.jpg")).toBe(false);
    expect(allowedImageUrl("http://scontent.fbcdn.net/image.jpg")).toBe(false);
    expect(allowedImageUrl("https://user:pass@scontent.fbcdn.net/image.jpg")).toBe(false);
    expect(publicAddress("8.8.8.8")).toBe(true);
  });
});
it("authenticates encrypted backups and still reads legacy gzip", () => {
  const data = Buffer.from('{"synthetic":true}'), secret = "synthetic-backup-master-only";
  const { cipher, header } = backupCipher(secret);
  const file = Buffer.concat([header, cipher.update(gzipSync(data)), cipher.final(), cipher.getAuthTag()]);
  expect(decodeBackup(file, secret)).toEqual(data);
  expect(() => decodeBackup(file, "wrong-synthetic-secret")).toThrow();
  const corrupt = Buffer.from(file); corrupt[25] ^= 1;
  expect(() => decodeBackup(corrupt, secret)).toThrow();
  expect(decodeBackup(gzipSync(data))).toEqual(data);
});
it("requires relevant evidence and approved links/numbers for drafts", () => {
  const facts = "รองเท้า 990 บาท https://shopee.co.th/approved";
  const draft = { message: facts, relevant: true, confidence: 0.95, evidence: ["หารองเท้า"] };
  expect(validatedDraft(draft, facts, "หารองเท้า").message).toBe(facts);
  for (const bad of [{ confidence: 0.4 }, { evidence: ["ไม่มีในโพสต์"] }, { relevant: false }, { message: "ราคา 9999" }, { message: "https://evil.test" }]) expect(() => validatedDraft({ ...draft, ...bad }, facts, "หารองเท้า")).toThrow();
});
it("redacts transport credentials in worker logs", () => {
  expect(redactLog("postgresql://user:secret@host/db Bearer synthetic-token ?key=example-secret")).not.toMatch(/secret|synthetic-token/);
});

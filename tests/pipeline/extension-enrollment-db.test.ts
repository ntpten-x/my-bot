import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const helper = process.getBuiltinModule("node:module").createRequire(`${process.cwd()}/package.json`)("./tests/helpers/pg-test-db.cjs");
  return { ...helper.setupTestDatabase("test_extension_enrollment"), drop: helper.dropTestSchema };
});
import { prisma } from "../../src/lib/prisma";
import { registerExtensionHash, revokeDevice, sha256, tokenHint, verifyDeviceToken } from "../../src/lib/extension-devices";
beforeAll(() => { if (fixture.enabled) execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { stdio: "pipe" }); },180000);
afterAll(async()=>{ if(fixture.enabled){await fixture.drop(prisma,fixture.schema);await prisma.$disconnect();} });
describe.skipIf(!fixture.enabled)("owner-session enrollment on disposable Postgres",()=>{
  it("registers concurrent retries idempotently and stores only a hash without starting automation",async()=>{
    const token="mbd_synthetic-browser-credential-only-for-test";
    const results=await Promise.all(Array.from({length:3},()=>registerExtensionHash(sha256(token),tokenHint(token),"Synthetic Chrome","127.0.0.1")));
    expect(new Set(results.map(result=>result?.deviceId)).size).toBe(1);
    expect(await prisma.extensionDevice.count()).toBe(1);
    expect(await verifyDeviceToken(token)).toBe(results[0]?.deviceId);
    const row=await prisma.extensionDevice.findFirstOrThrow();
    expect(row.tokenHash).toBe(sha256(token));expect(JSON.stringify(row)).not.toContain(token);
    expect(await prisma.setting.count()).toBe(0);expect(await prisma.autoCommentRule.count()).toBe(0);
  });
  it("does not resurrect revoked credentials when registration is retried",async()=>{
    const token="mbd_synthetic-revocation-credential";
    const first=await registerExtensionHash(sha256(token),tokenHint(token),"Revoked Chrome","127.0.0.1");
    await revokeDevice(first!.deviceId);
    expect(await registerExtensionHash(sha256(token),tokenHint(token),"Another name","127.0.0.1")).toBeNull();
    expect(await verifyDeviceToken(token)).toBeNull();
    expect(await prisma.extensionDevice.count({where:{tokenHash:sha256(token)}})).toBe(1);
    expect(await prisma.extensionDevice.findUniqueOrThrow({where:{id:first!.deviceId}})).toMatchObject({name:"Revoked Chrome"});
  });
});

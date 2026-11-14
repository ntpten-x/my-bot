import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { backupCipher, decodeBackup } from "../../src/lib/backup-crypto";
import { exportSecurityAudit } from "../../src/lib/audit-export";
import { execFileSync } from "node:child_process";
import path from "node:path";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const helper = process.getBuiltinModule("node:module").createRequire(`${process.cwd()}/package.json`)("./tests/helpers/pg-test-db.cjs");
  return { ...helper.setupTestDatabase("test_passport_auth"), drop: helper.dropTestSchema };
});
const browser = vi.hoisted(() => ({ cookie: "", ipIndex: 1 }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: browser.cookie }),
  cookies: async () => ({
    has: (name: string) => browser.cookie.split(";").some(part => part.trim().startsWith(`${name}=`)),
    get: (name: string) => { const part = browser.cookie.split(";").find(part => part.trim().startsWith(`${name}=`)); return part ? { value: part.trim().slice(name.length + 1) } : undefined; },
  }),
}));
import { prisma } from "../../src/lib/prisma";
import { beginMfa, changeMfa, ownerTotp, verifySecondFactor } from "../../src/lib/mfa";
import { verifySecurityAudit } from "../../src/lib/security-audit";
import { POST as mfaAction, GET as mfaStatus } from "../../src/app/api/auth/mfa/route";
import { POST as stepUp } from "../../src/app/api/auth/step-up/route";
import { authenticateOwner } from "../../src/lib/passport-auth";
import { getSession, createSession, sessionDigest } from "../../src/lib/auth";
import { POST as login } from "../../src/app/api/auth/login/route";
import { POST as setup } from "../../src/app/api/auth/setup/route";
import { POST as resetPassword } from "../../src/app/api/auth/reset-password/route";
import { POST as logout } from "../../src/app/api/auth/logout/route";
import { POST as changePassword } from "../../src/app/api/auth/change-password/route";
import { GET as listSessions, DELETE as revokeSession } from "../../src/app/api/auth/sessions/route";
import { snapshotDatabase, restoreDatabase } from "../../src/lib/backup-format";
import { dbGuardStore } from "../../src/lib/login-guard-db";
import { checkLogin, recordLogin } from "../../src/lib/login-guard";

const password = "Synthetic-Test-Owner-1234";
const request = (route: string, body: unknown) => new Request(`http://localhost:8001/api/auth/${route}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:8001", "x-forwarded-for": `127.0.0.${browser.ipIndex}`, cookie: browser.cookie }, body: JSON.stringify({ ...(route === "login" ? { username: "admin" } : {}), ...body as object }) });
const cookieOf = (response: Response) => response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).filter(cookie => !cookie.endsWith("=")).join("; ");

beforeAll(async () => {
  if (!fixture.enabled) return;
  vi.stubEnv("BACKUP_UPLOAD_URL", "");
  vi.stubEnv("BACKUP_ENCRYPTION_KEY", "");
  vi.stubEnv("SECURITY_AUDIT_KEY", "synthetic-append-only-audit-test-key");
  vi.stubEnv("AI_KEY_SECRET", "synthetic-mfa-audit-test-key-only");
  vi.stubEnv("AUTH_ALLOW_LEGACY_SESSIONS", "1");
  vi.stubEnv("TRUST_PROXY_HOPS", "1");
  vi.stubEnv("AUTH_URL", "http://localhost:8001");
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { stdio: "pipe" });
});
beforeEach(async () => {
  if (!fixture.enabled) return;
  browser.cookie = ""; browser.ipIndex++;
  await prisma.authUser.deleteMany(); await prisma.authRateLimit.deleteMany(); await prisma.owner.deleteMany(); await prisma.loginGuard.deleteMany();
  await prisma.owner.create({ data: { id: "owner-synthetic", passwordHash: await bcrypt.hash(password, 4) } });
});
afterAll(async () => { if (fixture.enabled) { await fixture.drop(prisma, fixture.schema); await prisma.$disconnect(); vi.unstubAllEnvs(); } });

describe.skipIf(!fixture.enabled)("Passport username/password and session boundaries", () => {
  it("logs the existing owner in with the unchanged password and revokes the session at logout", async () => {
    const response = await login(request("login", { password }));
    expect(response.status).toBe(200); browser.cookie = cookieOf(response);
    expect(browser.cookie).toContain("mybot_session=");
    expect(await getSession()).toMatchObject({ ownerId: "owner-synthetic" });
    expect(await prisma.session.count()).toBe(1);
    expect((await logout(request("logout", {}))).status).toBe(200);
    expect(await prisma.session.count()).toBe(0); expect(await getSession()).toBeNull();
  });
  it("requires the right username as well as password and keeps legacy sessions valid", async () => {
    const token = "a".repeat(64);
    await prisma.session.create({ data: { ownerId: "owner-synthetic", token, expiresAt: new Date(Date.now() + 60000) } });
    browser.cookie = `mybot_session=${token}`;
    expect(await getSession()).toMatchObject({ ownerId: "owner-synthetic" });
    expect((await login(request("login", { username: "wrong", password }))).status).toBe(401);
    expect((await login(request("login", { password: "wrong" }))).status).toBe(401);
    expect(await authenticateOwner("admin", password)).toMatchObject({ id: "owner-synthetic" });
  });
  it("stores new session credentials as digests and rejects digest replay", async () => {
    const token = await createSession("owner-synthetic");
    expect((await prisma.session.findFirstOrThrow()).token).toBe(sessionDigest(token));
    browser.cookie = `mybot_session=${sessionDigest(token)}`;
    expect(await getSession()).toBeNull();
    browser.cookie = `mybot_session=${token}`;
    expect(await getSession()).not.toBeNull();
  });
  it("changes the credential hash and revokes other browsers atomically", async () => {
    const first = await login(request("login", { password })); const firstCookie = cookieOf(first);
    const second = await login(request("login", { password })); const secondCookie = cookieOf(second);
    browser.cookie = firstCookie;
    const response = await changePassword(request("change-password", { current: password, next: "New-Synthetic-Owner-5678", confirm: "New-Synthetic-Owner-5678" }));
    expect(response.status).toBe(200); expect(await prisma.session.count()).toBe(1);
    expect(await getSession()).not.toBeNull(); browser.cookie = secondCookie; expect(await getSession()).toBeNull();
    expect((await login(request("login", { password }))).status).toBe(401);
    expect((await login(request("login", { password: "New-Synthetic-Owner-5678" }))).status).toBe(200);
  });
  it("rejects login session creation if the password changed concurrently", async () => {
    const owner = await prisma.owner.findFirstOrThrow();
    await prisma.owner.update({ where: { id: owner.id }, data: { passwordHash: await bcrypt.hash("New-Synthetic-Owner-5678", 4) } });
    await expect(createSession(owner.id, owner.passwordHash)).rejects.toThrow("Credentials changed");
    expect(await prisma.session.count()).toBe(0);
  });
  it("lists sessions without exposing tokens and revokes another browser only", async () => {
    browser.cookie = cookieOf(await login(request("login", { password })));
    const other = await prisma.session.create({ data: { id: "other-session", ownerId: "owner-synthetic", token: "synthetic-private-token", expiresAt: new Date(Date.now() + 60000) } });
    const response = await listSessions(), text = await response.text();
    expect(text).not.toContain("synthetic-private-token"); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(text).sessions.some((row: { current: boolean }) => row.current)).toBe(true);
    const requestDelete = new Request("http://localhost:8001/api/auth/sessions", { method: "DELETE", headers: { "content-type": "application/json", origin: "http://localhost:8001" }, body: JSON.stringify({ id: other.id }) });
    expect((await revokeSession(requestDelete)).status).toBe(200);
    expect(await prisma.session.findUnique({ where: { id: other.id } })).toBeNull();
    expect(await getSession()).not.toBeNull();
  });
  it("clears retired authentication tables on backup restore", async () => {
    browser.cookie = cookieOf(await login(request("login", { password })));
    await prisma.authUser.create({ data: { id: "retired", name: "Retired", email: "retired@example.invalid" } });
    const backup = JSON.parse(JSON.stringify(await snapshotDatabase(prisma)));
    expect(backup.tables.AuthSession).toBeUndefined();
    await restoreDatabase(prisma, backup);
    expect(await prisma.owner.count()).toBe(1);
    expect(await prisma.authUser.count()).toBe(0); expect(await prisma.authSession.count()).toBe(0);
    expect((await login(request("login", { password }))).status).toBe(200);
  });
  it("rejects browser cross-origin login before creating a session", async () => {
    const attack = request("login", { password }); attack.headers.set("origin", "https://other.example");
    expect((await login(attack)).status).toBe(403); expect(await prisma.session.count()).toBe(0);
  });
  it("requires a username and uses secure cookies on HTTPS", async () => {
    const missing = new Request("http://localhost:8001/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    expect((await login(missing)).status).toBe(400);
    const https = new Request("https://mybot.example/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password }) });
    const response = await login(https);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/i);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("set-cookie")).toMatch(/SameSite=lax/i);
  });
  it("sets up a chosen username with a bcrypt hash and keeps it after password recovery", async () => {
    vi.stubEnv("BOOTSTRAP_TOKEN", "synthetic-recovery-token-32-characters");
    await prisma.owner.deleteMany();
    const created = await setup(request("setup", { username: "owner.test", password, confirm: password, bootstrapToken: "synthetic-recovery-token-32-characters" }));
    expect(created.status).toBe(200);
    const owner = await prisma.owner.findFirstOrThrow();
    expect(owner.username).toBe("owner.test"); expect(owner.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, owner.passwordHash)).toBe(true);
    expect((await login(request("login", { username: "owner.test", password }))).status).toBe(200);
    const next = "Reset-Synthetic-Owner-5678";
    expect((await resetPassword(request("reset-password", { password: next, confirm: next, bootstrapToken: "synthetic-recovery-token-32-characters" }))).status).toBe(200);
    expect(await authenticateOwner("owner.test", password)).toBeNull();
    expect(await authenticateOwner("owner.test", next)).not.toBeNull();
  });
  it("does not lose concurrent failed-login increments across request handlers", async () => {
    await Promise.all(Array.from({ length: 5 }, () => recordLogin(dbGuardStore, "synthetic-address", false)));
    expect(await checkLogin(dbGuardStore, "synthetic-address")).toBeGreaterThan(0);
  });

  it("enrolls MFA only after proof, revokes older sessions and refuses password-only login", async () => {
    const oldCookie = cookieOf(await login(request("login", { password })));
    browser.cookie = cookieOf(await login(request("login", { password })));
    const current = await getSession();
    const enrollment = await beginMfa("owner-synthetic");
    expect((await prisma.owner.findFirstOrThrow()).mfaSecret).toBeNull();
    const result = await changeMfa("owner-synthetic", current!.id, "confirm", ownerTotp(enrollment.secret, "admin").generate());
    expect(result.recoveryCodes).toHaveLength(8);
    const owner = await prisma.owner.findFirstOrThrow();
    expect(owner.mfaSecret).not.toContain(enrollment.secret);
    expect(await getSession()).not.toBeNull();
    browser.cookie = oldCookie; expect(await getSession()).toBeNull();
    expect((await login(request("login", { password }))).status).toBe(401);
    expect((await login(request("login", { password, code: result.recoveryCodes[0] }))).status).toBe(200);
    expect((await login(request("login", { password, code: result.recoveryCodes[0] }))).status).toBe(401);
  });
  it("prevents replay of a TOTP and atomically consumes a recovery code only once", async () => {
    browser.cookie = cookieOf(await login(request("login", { password })));
    const current = await getSession(); const enrollment = await beginMfa("owner-synthetic");
    const code = ownerTotp(enrollment.secret, "admin").generate();
    const result = await changeMfa("owner-synthetic", current!.id, "confirm", code);
    expect(await verifySecondFactor("owner-synthetic", code)).toBeNull();
    const results = await Promise.all([verifySecondFactor("owner-synthetic", result.recoveryCodes[0]), verifySecondFactor("owner-synthetic", result.recoveryCodes[0])]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(createSession("owner-synthetic")).rejects.toThrow("Second factor required");
    expect(JSON.stringify(await prisma.recoveryCode.findMany())).not.toContain(result.recoveryCodes[0]);
  });
  it("expires idle sessions and requires step-up for old authentication", async () => {
    browser.cookie = cookieOf(await login(request("login", { password })));
    const current = await getSession();
    await prisma.session.update({ where: { id: current!.id }, data: { authenticatedAt: new Date(Date.now() - 6 * 60_000) } });
    const denied = await revokeSession(new Request("http://localhost:8001/api/auth/sessions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "other" }) }));
    expect(denied.status).toBe(403);
    expect((await stepUp(request("step-up", { password }))).status).toBe(200);
    await prisma.session.update({ where: { id: current!.id }, data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    expect(await getSession()).toBeNull();
  });
  it("makes audit records append-only and verifies their HMAC chain", async () => {
    await login(request("login", { password }));
    expect((await verifySecurityAudit()).valid).toBe(true);
    await expect(prisma.$executeRaw`UPDATE "SecurityAudit" SET outcome='tampered'`).rejects.toThrow();
    expect((await verifySecurityAudit()).valid).toBe(true);
    await expect(prisma.$executeRaw`TRUNCATE TABLE "SecurityAudit"`).rejects.toThrow();
  });
  it("never revives sessions or one-time recovery codes from a backup", async () => {
    browser.cookie = cookieOf(await login(request("login", { password })));
    const backup = JSON.parse(JSON.stringify(await snapshotDatabase(prisma)));
    await restoreDatabase(prisma, backup);
    expect(await getSession()).toBeNull();
    expect(await prisma.session.count()).toBe(0);
    expect((await verifySecurityAudit()).valid).toBe(true);
  });

  it("exports encrypted audit evidence and restores an encrypted backup only into a throwaway lab", async () => {
    browser.cookie = cookieOf(await login(request("login", { password })));
    const directory = mkdtempSync(path.join(tmpdir(), "mybot-restore-fixture-"));
    try {
      const exported = await exportSecurityAudit(prisma, directory, "synthetic-audit");
      const encrypted = readFileSync(exported.file);
      expect(encrypted.includes(Buffer.from("login.success"))).toBe(false);
      expect(decodeBackup(encrypted, "synthetic-mfa-audit-test-key-only").toString()).toContain("mybot-security-audit");
      const backup = await snapshotDatabase(prisma);
      const cipher = backupCipher("synthetic-mfa-audit-test-key-only");
      const body = Buffer.concat([cipher.header, cipher.cipher.update(gzipSync(JSON.stringify(backup))), cipher.cipher.final(), cipher.cipher.getAuthTag()]);
      const file = path.join(directory, "synthetic-backup.enc"); writeFileSync(file, body, { mode: 0o600 });
      const output = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/restore-drill.ts", file, "--lab"], { encoding: "utf8", env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] });
      expect(output).toContain('"restored":true'); expect(output).toContain('"sessionsRevoked":true');
      expect(await getSession()).not.toBeNull(); // Production-like source schema was never replaced.
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("gates MFA activation on all-host rollout and never exposes active secrets in status", async () => {
    browser.cookie = cookieOf(await login(request("login", { password })));
    vi.stubEnv("SECURITY_RELEASE_READY", "0");
    expect((await mfaAction(request("mfa", { action: "begin" }))).status).toBe(503);
    vi.stubEnv("SECURITY_RELEASE_READY", "1");
    const response = await mfaAction(request("mfa", { action: "begin" }));
    expect(response.status).toBe(200); const enrollment = await response.json();
    expect(enrollment.qr).toMatch(/^data:image\/png;base64,/);
    const confirm = await mfaAction(request("mfa", { action: "confirm", code: ownerTotp(enrollment.secret, "admin").generate() }));
    expect(confirm.status).toBe(200);
    const codes = (await confirm.json()).recoveryCodes;
    const status = await (await mfaStatus()).json();
    expect(status.enabled).toBe(true); expect(JSON.stringify(status)).not.toContain(enrollment.secret);
    vi.stubEnv("BOOTSTRAP_TOKEN", "synthetic-recovery-token-32-characters");
    const next = "Recovery-New-Synthetic-Owner-9012";
    expect((await resetPassword(request("reset-password", { bootstrapToken: "synthetic-recovery-token-32-characters", password: next, confirm: next }))).status).toBe(401);
    expect((await resetPassword(request("reset-password", { bootstrapToken: "synthetic-recovery-token-32-characters", password: next, confirm: next, code: codes[0] }))).status).toBe(200);
    expect((await prisma.owner.findFirstOrThrow()).mfaSecret).not.toBeNull();
  });
});

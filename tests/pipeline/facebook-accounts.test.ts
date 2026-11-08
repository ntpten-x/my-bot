import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ settings: vi.fn(), runtime: vi.fn(), verify: vi.fn(), auth: vi.fn(), account: vi.fn(), accounts: vi.fn(), installs: vi.fn(), upsert: vi.fn(), extensionAuth: vi.fn(), config: vi.fn(), ingest: vi.fn() }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { setting: { findMany: mocks.settings, findUnique: mocks.runtime, upsert: mocks.upsert }, fbAccount: { findUnique: mocks.account, findMany: mocks.accounts }, extensionHeartbeat: { findMany: mocks.installs } } }));
vi.mock("../../src/lib/extension-devices", () => ({ verifyDeviceToken: mocks.verify }));
vi.mock("../../src/lib/guard", () => ({ authed: mocks.auth }));
vi.mock("../../src/lib/auth", () => ({ requireExtensionToken: mocks.extensionAuth }));
vi.mock("../../src/lib/scrape-runs", () => ({ buildExtensionConfig: mocks.config }));
vi.mock("../../src/lib/ingest", () => ({ ingestPosts: mocks.ingest }));
vi.mock("../../src/lib/extension-heartbeat", () => ({ EXPECTED_EXTENSION_VERSION: "1.11.4", extensionVersionFromRequest: () => "1.11.4", isCurrentExtensionVersion: () => true, countCapturedPosts: vi.fn(), noteBadExtensionToken: vi.fn() }));
import { accountPresence, facebookWorkAllowed, ACCOUNT_PAUSE_PREFIX } from "../../src/lib/facebook-accounts";
import { GET } from "../../src/app/api/facebook-accounts/route";
import { PATCH } from "../../src/app/api/facebook-accounts/[id]/route";
import { GET as config } from "../../src/app/api/v1/extension-config/route";
import { GET as tasks } from "../../src/app/api/v1/extension/tasks/route";
import { POST as sample } from "../../src/app/api/v1/extension/sample/route";
import { POST as ingest } from "../../src/app/api/v1/ingest/route";
const req = (id?: string) => new Request("http://localhost", { headers: { ...(id ? { "x-facebook-user-id": id } : {}), authorization: "Bearer mbd_synthetic" } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.settings.mockResolvedValue([]); mocks.auth.mockResolvedValue({}); mocks.verify.mockResolvedValue(null); mocks.runtime.mockResolvedValue(null);
  mocks.account.mockResolvedValue({ id: "12345" }); mocks.extensionAuth.mockResolvedValue(true); mocks.config.mockResolvedValue({ groups: [{ id: "group1" }] });
});
it("uses fresh logged-in heartbeats from any install, ignoring a logged-out or stale browser", () => {
  const now = Date.now();
  const rows = [ { id: "old", fbUserId: "12345", fbLoggedIn: true, enabled: true, lastSeenAt: new Date(now - 181000) }, { id: "live", fbUserId: "12345", fbLoggedIn: true, enabled: false, lastSeenAt: new Date(now) }, { id: "logout", fbUserId: "12345", fbLoggedIn: false, enabled: true, lastSeenAt: new Date(now) } ];
  expect(accountPresence("12345", rows, now)).toEqual({ connected: true, localEnabled: false, liveInstallIds: ["live"] });
  expect(accountPresence("12345", rows.slice(0, 1), now).connected).toBe(false);
});
it("persists pause and resume separately from browser presence", async () => {
  for (const enabled of [false, true]) {
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ enabled }) }), { params: Promise.resolve({ id: "12345" }) });
    expect(response.status).toBe(200);
    expect(mocks.upsert).toHaveBeenLastCalledWith({ where: { key: `${ACCOUNT_PAUSE_PREFIX}12345` }, create: { key: `${ACCOUNT_PAUSE_PREFIX}12345`, value: enabled ? "0" : "1" }, update: { value: enabled ? "0" : "1" } });
  }
});
it("requires an owner session and an existing account for changes", async () => {
  mocks.auth.mockResolvedValue({ error: new Response(null, { status: 401 }) });
  expect((await PATCH(req(), { params: Promise.resolve({ id: "12345" }) })).status).toBe(401);
  mocks.auth.mockResolvedValue({}); mocks.account.mockResolvedValue(null);
  expect((await PATCH(new Request("http://localhost", { method: "PATCH", body: '{"enabled":true}' }), { params: Promise.resolve({ id: "12345" }) })).status).toBe(404);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it("blocks paused identities from either body, header, or the paired device heartbeat", async () => {
  mocks.settings.mockResolvedValue([{ key: `${ACCOUNT_PAUSE_PREFIX}12345` }]);
  expect(await facebookWorkAllowed(req("12345"))).toBe(false);
  expect(await facebookWorkAllowed(req("67890"), "12345")).toBe(false);
  expect(await facebookWorkAllowed(req("67890"))).toBe(true);
  mocks.verify.mockResolvedValue("device1"); mocks.runtime.mockResolvedValue({ value: JSON.stringify({ fbUserId: "12345" }) });
  expect(await facebookWorkAllowed(req("67890"))).toBe(false);
  expect(await facebookWorkAllowed(req())).toBe(false);
});
it("fails closed for unknown identities when pause controls are active", async () => {
  mocks.settings.mockResolvedValue([{ key: `${ACCOUNT_PAUSE_PREFIX}12345` }]);
  expect(await facebookWorkAllowed(req())).toBe(false);
  mocks.settings.mockResolvedValue([]); expect(await facebookWorkAllowed(req())).toBe(true);
});
it("withholds group schedules and ingest acknowledgments for a paused account", async () => {
  mocks.settings.mockResolvedValue([{ key: `${ACCOUNT_PAUSE_PREFIX}12345` }]);
  const response = await config(req("12345")); expect(await response.json()).toMatchObject({ groups: [], accountPaused: true, scrapeAllowed: false, upgradeRequired: false });
  expect(mocks.config).not.toHaveBeenCalled();
  const upload = await ingest(new Request("http://localhost", { method: "POST", body: JSON.stringify({ sourceUrl: "https://facebook.com/groups/111", posts: [{ text: "synthetic", url: "https://facebook.com/groups/111/posts/222" }], fbUserId: "12345" }) }));
  expect(upload.status).toBe(423); expect(await upload.json()).toMatchObject({ code: "ACCOUNT_PAUSED" }); expect(mocks.ingest).not.toHaveBeenCalled();
});
it("separates online presence, owner pause, and local pause in the account list", async () => {
  const now = new Date();
  mocks.accounts.mockResolvedValue([{ id: "12345", name: "บัญชีทดสอบ", browser: "Chrome", profileLabel: "", lastSeenAt: now, firstSeenAt: now, postsCaptured: 10 }]);
  mocks.installs.mockResolvedValue([{ id: "install1", fbUserId: "12345", fbLoggedIn: true, enabled: true, lastSeenAt: now, version: "1.11.4" }]);
  mocks.settings.mockResolvedValue([{ key: `${ACCOUNT_PAUSE_PREFIX}12345` }]);
  const response = await GET(); expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).accounts[0]).toMatchObject({ enabled: false, connected: true, status: "paused", localEnabled: true });
  mocks.settings.mockResolvedValue([]);
  expect((await (await GET()).json()).accounts[0]).toMatchObject({ enabled: true, status: "ready" });
});

it("does not hand paused accounts manual fetch tasks or accept parser samples", async () => {
  mocks.settings.mockResolvedValue([{ key: `${ACCOUNT_PAUSE_PREFIX}12345` }]);
  expect(await (await tasks(req("12345"))).json()).toMatchObject({ tasks: [], accountPaused: true });
  const response = await sample(new Request("http://localhost", { method: "POST", headers: { "x-facebook-user-id": "12345" }, body: JSON.stringify({ sourceUrl: "https://facebook.com/groups/111", posts: [] }) }));
  expect(response.status).toBe(423);
});

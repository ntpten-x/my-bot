// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "../../src/app/(app)/auto-comment/page";
import { CommentReadinessPanel } from "../../src/components/comment-readiness";
import { sortAccountsOnlineFirst, sortDevicesOnlineFirst } from "../../src/components/type-comment-form";
const dashboard = { control: { state: "stopped", dryRun: true, emergency: false, hourlyLimit: 5, dailyLimit: 20, cooldownUntil: null }, rules: [], sources: [], jobs: [], logs: [], counts: {}, observed: 0, matched: 0 };
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const response = url === "/api/automation-readiness" ? { extensions: [{ id: "device", name: "Chrome ทดสอบ", online: true, fbUserId: "123456", commentsEnabled: true }], accounts: [{ id: "123456", name: "บัญชีทดสอบ" }] }
      : url === "/api/facebook-accounts" ? { accounts: [{ id: "123456", name: "บัญชีทดสอบ", enabled: true, connected: true }] }
      : url === "/api/auto-comment/type-options" ? { categories: [{ id: "games", slug: "games", name: "เกม" }], products: [{ id: "roblox", name: "Roblox", categorySlug: "games", enabled: true }], templates: [{ id: "message1", name: "แนะนำร้าน", body: "ข้อความแรก", categoryId: "games", productId: "roblox", sourceIds: "" }, { id: "message2", name: "โปรโมชัน", body: "ข้อความที่สอง", categoryId: "games", productId: "roblox", sourceIds: "" }], sources: [{ id: "group", name: "กลุ่ม Roblox", enabled: true, boundCategorySlug: "games", defaultProductId: "roblox" }], setups: {} }
      : dashboard;
    return new Response(JSON.stringify(response), { status: 200 });
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function renderEditor() {
  await act(async () => root.render(React.createElement(Page)));
  const create = Array.from(container.querySelectorAll("button")).find(node => node.textContent === "สร้างชุดคอมเมนต์")!;
  await act(async () => create.click());
}

it("keeps online Chrome profiles and Facebook accounts at the top of connection pickers", () => {
  expect(sortDevicesOnlineFirst([
    { id: "a", name: "Chrome Win32 offline", online: false },
    { id: "b", name: "Chrome Win32 live", online: true },
    { id: "c", name: "Chrome Linux offline", online: false },
  ]).map(row => row.id)).toEqual(["b", "c", "a"]);
  expect(sortAccountsOnlineFirst([
    { id: "2", name: "บัญชีออฟไลน์", connected: false },
    { id: "1", name: "บัญชีออนไลน์", connected: true },
  ]).map(row => row.id)).toEqual(["1", "2"]);
});

it("renders browser delivery with safe defaults and no Facebook credential fields", async () => {
  await act(async () => { root.render(React.createElement(Page)); });
  expect(container.textContent).toContain("คอมเมนต์จริงผ่าน Extension"); expect(container.textContent).not.toContain("Dry Run"); expect(container.textContent).toContain("หยุดอยู่");
  expect(container.querySelector("#page-token")).toBeNull(); expect(container.querySelector("#manager-token")).toBeNull();
  expect(container.querySelector("form")).toBeNull();
  expect(container.textContent).toContain("ชุดคอมเมนต์ตามประเภท");
  expect(container.textContent).toContain("Extension"); expect(container.textContent).toContain("3 วินาที");
  const start = Array.from(container.querySelectorAll("button")).find(node => node.textContent?.includes("Start"))!;
  await act(async () => start.click());
  expect(fetch).toHaveBeenCalledWith("/api/auto-comment", expect.objectContaining({ method: "PUT", body: '{"action":"start"}' }));
});
it("keeps Emergency Stop actionable and requests only the emergency command", async () => {
  await act(async () => root.render(React.createElement(Page)));
  const emergency = Array.from(container.querySelectorAll("button")).find(node => node.textContent?.includes("Emergency Stop"))!;
  expect(emergency.disabled).toBe(false); await act(async () => emergency.click());
  expect(fetch).toHaveBeenCalledWith("/api/auto-comment", expect.objectContaining({ method: "PUT", body: '{"action":"emergency"}' }));
});

it("starts with random messages, all-day scheduling and a one-minute group cooldown", async () => {
  await renderEditor();
  expect(container.querySelector<HTMLSelectElement>("#template-order")!.value).toBe("random");
  expect(container.querySelector<HTMLInputElement>("#comment-start")!.value).toBe("00:00");
  expect(container.querySelector<HTMLInputElement>("#comment-end")!.value).toBe("00:00");
  expect(container.querySelector<HTMLInputElement>("#post-age")!.value).toBe("6");
  expect(container.querySelector<HTMLInputElement>("#area-cooldown")!.value).toBe("1");
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init || !["POST", "PUT"].includes(init.method ?? ""))).toBe(true);
});

async function fill(selector: string, value: string) {
  const node = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choose(selector: string, value: string) {
  await act(async () => { const node = container.querySelector<HTMLSelectElement>(selector)!; node.value = value; node.dispatchEvent(new Event("change", { bubbles: true })); });
}
it("selects catalog messages and groups by type and saves an account-pinned random rule", async () => {
  await renderEditor();
  await choose("#comment-type", "roblox");
  expect(container.textContent).toContain("เลือกแล้ว 2 ชุด");
  await choose("#browser-account", "123456"); await choose("#browser-device", "device");
  await fill("#rule-name", "Roblox 2 ข้อความ");
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(String(call[1]!.body))).toMatchObject({ typeProductId: "roblox", replyTemplateIds: ["message1", "message2"], sourceIds: ["group"], selectionMode: "random", browserFbUserId: "123456", browserDeviceId: "device", enabled: false, templates: [], startMinute: 0, endMinute: 1440, areaCooldownSec: 60, maxAgeHours: 6, requireAi: false });
});
it("rejects an incomplete type setup without creating a rule", async () => {
  await renderEditor();
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(container.querySelector('[role="alert"]')!.textContent).toContain("เลือกประเภท");
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});
it("supports choosing one fixed catalog message", async () => {
  await renderEditor();
  await choose("#comment-type", "roblox"); await choose("#template-order", "fixed");
  expect(container.querySelectorAll('input[name="selected-message"]:checked')).toHaveLength(1);
  const second = container.querySelectorAll<HTMLInputElement>('input[name="selected-message"]')[1];
  await act(async () => second.click());
  expect(second.checked).toBe(true); expect(container.querySelectorAll('input[name="selected-message"]:checked')).toHaveLength(1);
});

it("shows live-only mode and the bound device opt-in as blockers even when a different device is ready", async () => {
  const rule = { id: "rule", name: "กฎทดสอบ", enabled: true, browserDeviceId: "bound", browserFbUserId: "123456", browserConsent: true, pausedReason: "", deliveryMode: "extension", requireAi: false, messageMode: "template" };
  const readiness = { extensions: [
    { id: "bound", name: "เครื่องที่ผูก", online: true, fbUserId: "123456", commentsEnabled: false },
    { id: "other", name: "เครื่องอื่น", online: true, fbUserId: "123456", commentsEnabled: true },
  ], accounts: [], steps: [{ key: "worker", ready: true }, { key: "ai", ready: false }] };
  await act(async () => root.render(React.createElement(CommentReadinessPanel, { control: dashboard.control, rules: [rule], readiness })));
  expect(container.textContent).toContain("ส่งคอมเมนต์จริงตามกฎที่เปิดไว้"); expect(container.textContent).not.toContain("Dry Run");
  expect(container.textContent).toContain("Extension ปิดรับงานคอมเมนต์");
  expect(container.textContent).toContain("กฎนี้ไม่รอ AI แม้ผู้ให้บริการ AI ไม่พร้อม");
  readiness.extensions[0].commentsEnabled = true;
  await act(async () => root.render(React.createElement(CommentReadinessPanel, { control: dashboard.control, rules: [rule], readiness })));
  expect(container.textContent).toContain("อุปกรณ์และบัญชีพร้อมรับงาน");
});

it("has no simulation controls and saves quotas without starting work", async () => {
  await act(async () => root.render(React.createElement(Page)));
  expect(container.textContent).not.toContain("Dry Run");
  expect(container.querySelector('option[value="dry_run"]')).toBeNull();
  const save = Array.from(container.querySelectorAll("button")).find(node => node.textContent === "บันทึกข้อจำกัด")!;
  await act(async () => save.click());
  expect(fetch).toHaveBeenCalledWith("/api/auto-comment", expect.objectContaining({ method: "PUT", body: '{"hourlyLimit":5,"dailyLimit":20}' }));
});

it("saves a disabled draft without an installed extension or observed Facebook account", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (url === "/api/facebook-accounts") return new Response('{"accounts":[]}');
    if (url === "/api/automation-readiness") return new Response('{"accounts":[],"extensions":[]}');
    return original(url, init);
  });
  await renderEditor();
  await choose("#comment-type", "roblox");
  expect(container.querySelector<HTMLSelectElement>("#browser-account")!.required).toBe(false);
  expect(container.querySelector<HTMLSelectElement>("#browser-device")!.required).toBe(false);
  expect(container.textContent).toContain("บันทึกฉบับร่าง");
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(String(call[1]!.body))).toMatchObject({ enabled: false, browserDeviceId: "", browserFbUserId: "", browserConsent: false, typeProductId: "roblox", replyTemplateIds: ["message1", "message2"] });
});

it("refreshes newly connected accounts without clearing the unsaved draft", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  let installed = false;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (url === "/api/facebook-accounts" && !installed) return new Response('{"accounts":[]}');
    return original(url, init);
  });
  await renderEditor();
  await choose("#comment-type", "roblox"); await fill("#rule-name", "ตั้งไว้ก่อนติดตั้ง");
  installed = true;
  const refresh = Array.from(container.querySelectorAll("button")).find(node => node.textContent === "ตรวจบัญชีและอุปกรณ์อีกครั้ง")!;
  await act(async () => refresh.click());
  expect(container.querySelector<HTMLSelectElement>("#browser-account")!.textContent).toContain("บัญชีทดสอบ");
  expect(container.querySelector<HTMLInputElement>("#rule-name")!.value).toBe("ตั้งไว้ก่อนติดตั้ง");
  expect(container.querySelector<HTMLSelectElement>("#comment-type")!.value).toBe("roblox");
});

const savedRule = () => ({ id: "saved", revision: 4, name: "Roblox ชุดประจำ", typeInfo: { id: "roblox", name: "Roblox", categoryName: "เกม" }, enabled: true, sourceIds: ["group"], templates: [{ body: "ข้อความแรก" }, { body: "ข้อความที่สอง" }], selectionMode: "random", startMinute: 0, endMinute: 1440, days: [0, 1, 2, 3, 4, 5, 6], maxAgeHours: 6, areaCooldownSec: 60, browserDeviceId: "device", browserFbUserId: "123456", browserConsent: true, keywords: "roblox", excludeKeywords: "", keywordMode: "any", priority: 0, deliveryMode: "extension", requireAi: false, messageMode: "template", pausedReason: "" });
function isDashboardUrl(url: unknown) {
  const value = String(url);
  return value === "/api/auto-comment" || value.startsWith("/api/auto-comment?");
}
it("lists a type with its own switch and opens the same editor with saved values", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  const rule = savedRule();
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (isDashboardUrl(url)) return new Response(JSON.stringify({ ...dashboard, rules: [rule] }));
    if (url === "/api/auto-comment/rules/saved" && init?.method === "PATCH") { rule.enabled = JSON.parse(String(init.body)).enabled; rule.revision++; return new Response(JSON.stringify(rule)); }
    return original(url, init);
  });
  await act(async () => root.render(React.createElement(Page)));
  expect(container.querySelector("form")).toBeNull(); expect(container.textContent).toContain("Roblox"); expect(container.textContent).toContain("2 ข้อความ");
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="เปิดปิดชุด Roblox"]')!;
  expect(toggle.getAttribute("aria-checked")).toBe("true"); await act(async () => toggle.click());
  expect(fetch).toHaveBeenCalledWith("/api/auto-comment/rules/saved", expect.objectContaining({ method: "PATCH", body: '{"enabled":false,"revision":4}' }));
  expect(container.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="แก้ไขชุด Roblox"]')!.click());
  expect(container.querySelector<HTMLInputElement>("#rule-name")!.value).toBe("Roblox ชุดประจำ");
  expect(container.querySelector<HTMLSelectElement>("#comment-type")!.value).toBe("roblox");
  expect(container.querySelectorAll('input[name="selected-message"]:checked')).toHaveLength(2);
});

it("shows paused rules and deferred wait reasons instead of a false open/ready state", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  const rule = { ...savedRule(), pausedReason: "ผลไม่ชัดเจนหลายครั้งติดกัน ตรวจ Facebook ก่อนเปิดกฎนี้ใหม่ ระบบส่วนกลางยังทำงานต่อได้" };
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (isDashboardUrl(url)) return new Response(JSON.stringify({
      ...dashboard,
      rules: [rule],
      counts: { browser_observed: 2, browser_ready: 1, uncertain: 3 },
      jobs: [{ id: "job1", status: "browser_ready", message: "สนใจ", externalUrl: "https://www.facebook.com/groups/1/posts/2/", lastError: "รอระยะพักของกลุ่ม", dryRun: false, createdAt: new Date().toISOString(), remoteCommentId: null }],
      jobsPage: { offset: 0, limit: 10, total: 1, hasMore: false },
    }));
    return original(url, init);
  });
  await act(async () => root.render(React.createElement(Page)));
  expect(container.textContent).toContain("พักแล้ว · แก้ไขเพื่อเปิดใหม่");
  expect(container.textContent).toContain("พักไว้: ผลไม่ชัดเจนหลายครั้งติดกัน");
  expect(container.textContent).toContain("รอระยะพักของกลุ่ม");
  expect(container.textContent).toMatch(/ส่งสำเร็จทั้งหมด[\s\S]*2/);
});

it("paginates auto-comment job history ten rows per page", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  const jobs = Array.from({ length: 10 }, (_, index) => ({
    id: `job-${index}`, status: "browser_ready", message: `ข้อความ ${index}`,
    externalUrl: "https://www.facebook.com/groups/1/posts/2/", lastError: "", dryRun: false,
    createdAt: new Date(Date.now() - index * 1000).toISOString(), remoteCommentId: null,
  }));
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (isDashboardUrl(url)) {
      const query = new URL(String(url), "http://local.test");
      expect(query.searchParams.get("jobsLimit")).toBe("10");
      return new Response(JSON.stringify({
        ...dashboard,
        jobs,
        jobsPage: { offset: Number(query.searchParams.get("jobsOffset") || 0), limit: 10, total: 65, hasMore: true },
      }));
    }
    return original(url, init);
  });
  await act(async () => root.render(React.createElement(Page)));
  expect(container.textContent).toContain("แสดงทีละ 10 งาน");
  expect(container.textContent).toContain("รวม 65 งาน");
  expect(container.textContent).toMatch(/หน้า 1\/7/);
  expect(container.querySelector('[aria-label="เลือกหน้าประวัติงาน"]')).toBeTruthy();
  const next = Array.from(container.querySelectorAll("button")).find(node => node.textContent === "ถัดไป")!;
  await act(async () => next.click());
  const called = vi.mocked(fetch).mock.calls.map(([url]) => String(url)).find(url => url.includes("jobsOffset=10"));
  expect(called).toContain("jobsLimit=10");
});
it("returns a newly saved type draft directly to the list", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  let stored: ReturnType<typeof savedRule> | undefined;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (url === "/api/auto-comment/rules" && init?.method === "POST") { stored = { ...savedRule(), enabled: false, browserDeviceId: "", browserFbUserId: "", browserConsent: false }; return new Response('{"id":"saved"}'); }
    if (isDashboardUrl(url)) return new Response(JSON.stringify({ ...dashboard, rules: stored ? [stored] : [] }));
    return original(url, init);
  });
  await renderEditor(); await choose("#comment-type", "roblox");
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(container.querySelector("form")).toBeNull(); expect(container.textContent).toContain("ฉบับร่าง · รอเชื่อมต่อ");
  expect(container.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(false);
  expect(container.querySelector('[aria-label="แก้ไขชุด Roblox"]')).not.toBeNull();
});

it("lets an unbound saved type switch its desired state and exposes a delete action", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  const rule = { ...savedRule(), enabled: false, browserDeviceId: "", browserFbUserId: "", browserConsent: false };
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (isDashboardUrl(url)) return new Response(JSON.stringify({ ...dashboard, rules: [rule] }));
    if (url === "/api/auto-comment/rules/saved" && init?.method === "PATCH") { rule.enabled = true; rule.revision++; return new Response(JSON.stringify(rule)); }
    return original(url, init);
  });
  await act(async () => root.render(React.createElement(Page)));
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle.disabled).toBe(false);
  await act(async () => toggle.click());
  expect(fetch).toHaveBeenCalledWith("/api/auto-comment/rules/saved", expect.objectContaining({ method: "PATCH", body: '{"enabled":true,"revision":4}' }));
  expect(container.querySelector('[aria-label="ลบชุด Roblox"]')).not.toBeNull();
});

it("deletes a saved type from the list after confirmation without calling global Start", async () => {
  vi.stubGlobal("confirm", vi.fn(() => true));
  const original = vi.mocked(fetch).getMockImplementation()!;
  let removed = false;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (isDashboardUrl(url)) return new Response(JSON.stringify({ ...dashboard, rules: removed ? [] : [savedRule()] }));
    if (url === "/api/auto-comment/rules/saved" && init?.method === "DELETE") { removed = true; return new Response('{"ok":true}'); }
    return original(url, init);
  });
  await act(async () => root.render(React.createElement(Page)));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="ลบชุด Roblox"]')!.click());
  expect(fetch).toHaveBeenCalledWith("/api/auto-comment/rules/saved", expect.objectContaining({ method: "DELETE", body: '{"revision":4}' }));
  expect(container.querySelector('[aria-label="ลบชุด Roblox"]')).toBeNull();
  expect(container.textContent).toContain("ประวัติงานยังอยู่");
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});

it("does not let an older background refresh overwrite a just-saved switch", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  const rule = savedRule(); let reads = 0; let release!: (response: Response) => void;
  const oldPayload = JSON.stringify({ ...dashboard, rules: [savedRule()] });
  const delayed = new Promise<Response>(resolve => { release = resolve; });
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (isDashboardUrl(url)) { reads++; if (reads === 2) return delayed; return new Response(JSON.stringify({ ...dashboard, rules: [rule] })); }
    if (url === "/api/auto-comment/rules/saved" && init?.method === "PATCH") { rule.enabled = false; rule.revision++; return new Response(JSON.stringify(rule)); }
    return original(url, init);
  });
  await act(async () => root.render(React.createElement(Page)));
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(reads).toBeGreaterThanOrEqual(2);
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  await act(async () => release(new Response(oldPayload)));
  expect(container.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
});

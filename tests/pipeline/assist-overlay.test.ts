// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const ext = path.resolve(__dirname, "../../extension");

type Assist = {
  MAX_TEXT: number;
  countPosted(doc: Document, text: string): number;
  looksSent(doc: Document, text: string, baseline: number): boolean;
  normalize(text: string): string;
  runAssist(text: string, options?: unknown): Promise<{ ok: boolean }>;
};
type Mounted = {
  host: HTMLElement;
  state: { inserted: boolean; insertedText: string; finished: boolean; detected: boolean; baseline: number };
  insert(): Promise<{ ok: boolean }>;
  finish(action: "sent" | "skip", detected?: boolean): Promise<{ ok: boolean }>;
  destroy(): void;
  check(): void;
  elements: {
    select: HTMLSelectElement;
    draft: HTMLTextAreaElement;
    insertBtn: HTMLButtonElement;
    sentBtn: HTMLButtonElement;
    skipBtn: HTMLButtonElement;
    status: HTMLElement;
    countdown: HTMLElement;
    countdownText: HTMLElement;
  };
};
type Listener = (message: unknown, sender: unknown, sendResponse?: (value: unknown) => void) => void;

let assist: Assist;
let overlay: { mount(payload: unknown, deps?: unknown): Mounted };

beforeAll(() => {
  // jsdom has no layout, so make every element look visible to findCommentBox.
  Element.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
  assist = require(path.join(ext, "assist.js")) as Assist;
  overlay = require(path.join(ext, "overlay.js")) as typeof overlay;
});

afterEach(() => {
  document.body.innerHTML = "";
});

function commentBox() {
  const box = document.createElement("textarea");
  box.setAttribute("aria-label", "Write a comment");
  document.body.appendChild(box);
  return box;
}

function setup(payload: Record<string, unknown> = {}, sendReply: unknown = { ok: true }) {
  const sent: Record<string, unknown>[] = [];
  const listeners: Listener[] = [];
  const send = vi.fn(async (message: Record<string, unknown>) => {
    sent.push(message);
    return typeof sendReply === "function" ? (sendReply as (m: unknown) => unknown)(message) : sendReply;
  });
  const ui = overlay.mount(
    {
      itemId: "item1",
      postId: "post1",
      text: "สนใจครับ ทักแชทมาคุยรายละเอียดได้เลยครับ",
      templates: [
        { id: "t1", name: "แบบสั้น", text: "สวัสดีครับ รับงานนี้ได้ ทักมาได้เลย" },
        { id: "t2", name: "แบบยาว", text: "สวัสดีครับ ผมทำงานด้านนี้มาหลายปี ทักแชทมาคุยได้ครับ" },
      ],
      prefs: {},
      ...payload,
    },
    { send, listen: (fn: Listener) => listeners.push(fn), timeoutMs: 50, intervalMs: 10, now: () => 1_000_000 },
  );
  return { ui, sent, send, listeners };
}

describe("passive sent detection", () => {
  it("counts the reply only outside the comment box and the overlay", () => {
    const text = "สนใจครับ ทักแชทมาคุยรายละเอียดได้เลยครับ";
    const box = commentBox();
    box.value = text;
    expect(assist.countPosted(document, text)).toBe(0);
    expect(assist.looksSent(document, text, 0)).toBe(false);

    const comment = document.createElement("div");
    comment.setAttribute("role", "article");
    comment.textContent = `TENX  ${text}`;
    document.body.appendChild(comment);
    expect(assist.countPosted(document, text)).toBe(1);
    // Still in the box (not sent yet, e.g. a preview) -> not considered sent.
    expect(assist.looksSent(document, text, 0)).toBe(false);
    box.value = "";
    expect(assist.looksSent(document, text, 0)).toBe(true);
    // Already on the page before inserting -> needs a new copy.
    expect(assist.looksSent(document, text, 1)).toBe(false);
    expect(assist.countPosted(document, "สั้น")).toBe(0);
  });
});

describe("assist overlay", () => {
  it("shows the draft and switches templates (empty choice restores the prepared text)", () => {
    const { ui } = setup();
    expect(document.querySelectorAll("[data-mybot-overlay]")).toHaveLength(1);
    const { select, draft } = ui.elements;
    expect(draft.value).toBe("สนใจครับ ทักแชทมาคุยรายละเอียดได้เลยครับ");
    expect(select.options).toHaveLength(3);
    select.value = "t2";
    select.dispatchEvent(new Event("change"));
    expect(draft.value).toBe("สวัสดีครับ ผมทำงานด้านนี้มาหลายปี ทักแชทมาคุยได้ครับ");
    select.value = "";
    select.dispatchEvent(new Event("change"));
    expect(draft.value).toBe("สนใจครับ ทักแชทมาคุยรายละเอียดได้เลยครับ");
  });

  it("inserts the edited draft into the comment box and re-insert replaces it", async () => {
    const box = commentBox();
    const { ui } = setup();
    ui.elements.draft.value = "ข้อความที่แก้เองก่อนใส่ครับ";
    expect((await ui.insert()).ok).toBe(true);
    expect(box.value).toBe("ข้อความที่แก้เองก่อนใส่ครับ");
    ui.elements.draft.value = "แก้อีกรอบหนึ่งแล้วใส่ใหม่ครับ";
    await ui.insert();
    expect(box.value).toBe("แก้อีกรอบหนึ่งแล้วใส่ใหม่ครับ");
    expect(ui.state.inserted).toBe(true);
    ui.destroy();
  });

  it("auto-inserts on mount only when the owner enabled it", async () => {
    const box = commentBox();
    setup({ prefs: { autoInsert: true } });
    await vi.waitFor(() => expect(box.value).toBe("สนใจครับ ทักแชทมาคุยรายละเอียดได้เลยครับ"));
    document.body.innerHTML = "";
    const box2 = commentBox();
    setup();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(box2.value).toBe("");
  });

  it("marks sent with the edited text and shows the auto-advance countdown", async () => {
    commentBox();
    const { ui, sent } = setup({}, { ok: true, advance: { at: 1_000_000 + 125_000 } });
    ui.elements.draft.value = "ข้อความสุดท้าย";
    await ui.finish("sent");
    expect(sent).toEqual([{ type: "assist-finish", action: "sent", text: "ข้อความสุดท้าย", detected: false }]);
    expect(ui.state.finished).toBe(true);
    expect(ui.elements.countdown.hidden).toBe(false);
    expect(ui.elements.countdownText.textContent).toContain("2:05");
    // A second press does nothing.
    await ui.finish("skip");
    expect(sent).toHaveLength(1);
    ui.destroy();
  });

  it("shows why it will not auto-advance (cap / empty)", async () => {
    const { ui } = setup({}, { ok: true, advance: { reason: "ครบโควตาวันนี้แล้ว" } });
    await ui.finish("skip");
    expect(ui.elements.countdown.hidden).toBe(true);
    expect(ui.elements.status.textContent).toContain("ครบโควตาวันนี้แล้ว");
  });

  it("keeps the buttons usable when saving fails", async () => {
    const { ui } = setup({}, { ok: false, error: "ติดต่อ MY-BOT ไม่ได้" });
    await ui.finish("sent");
    expect(ui.state.finished).toBe(false);
    expect(ui.elements.sentBtn.disabled).toBe(false);
    expect(ui.elements.status.textContent).toContain("ติดต่อ MY-BOT ไม่ได้");
  });

  it("offers one-click sent when the comment appears, and auto-marks only if enabled", async () => {
    const box = commentBox();
    const { ui, sent } = setup();
    await ui.insert();
    box.value = "";
    const comment = document.createElement("div");
    comment.setAttribute("dir", "auto");
    comment.textContent = "สนใจครับ ทักแชทมาคุยรายละเอียดได้เลยครับ";
    document.body.appendChild(comment);
    ui.check();
    expect(ui.state.detected).toBe(true);
    expect(ui.elements.sentBtn.classList.contains("hint")).toBe(true);
    expect(sent).toHaveLength(0);
    ui.destroy();

    document.body.innerHTML = "";
    const box2 = commentBox();
    const auto = setup({ prefs: { autoMarkSent: true } });
    await auto.ui.insert();
    box2.value = "";
    document.body.appendChild(comment.cloneNode(true));
    auto.ui.check();
    await vi.waitFor(() => expect(auto.sent).toHaveLength(1));
    expect(auto.sent[0]).toMatchObject({ type: "assist-finish", action: "sent", detected: true });
    auto.ui.destroy();
  });

  it("handles the Alt+Shift+S / Alt+Shift+K extension command and countdown updates", async () => {
    const { ui, sent, listeners } = setup({}, { ok: true });
    const reply = vi.fn();
    listeners[0]({ type: "command-finish", action: "skip" }, {}, reply);
    expect(reply).toHaveBeenCalledWith({ handled: true });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ action: "skip" });
    listeners[0]({ type: "advance-status", at: 1_000_000 + 30_000 }, {});
    expect(ui.elements.countdownText.textContent).toContain("0:30");
    listeners[0]({ type: "advance-status", at: 0, reason: "ไม่มีลีดถัดไป" }, {});
    expect(ui.elements.countdown.hidden).toBe(true);
  });

  it("without a queue item only offers insert (no sent/skip)", () => {
    const { ui } = setup({ itemId: "", postId: "" });
    expect(ui.elements.sentBtn.hidden).toBe(true);
    expect(ui.elements.skipBtn.hidden).toBe(true);
  });

  it("keeps typing inside the overlay away from Facebook's page shortcuts", () => {
    const { ui } = setup();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    ui.elements.draft.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true, composed: true }));
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener("keydown", seen);
  });
});

describe("overlay safety policy", () => {
  const src = readFileSync(path.join(ext, "overlay.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("never clicks, fakes keys, submits, dispatches events or calls GraphQL", () => {
    expect(src).not.toMatch(/\.click\s*\(/);
    expect(src).not.toMatch(/["']Enter["']|KeyboardEvent|dispatchEvent/);
    expect(src).not.toMatch(/submit/i);
    expect(src).not.toMatch(/graphql/i);
    expect(src).not.toMatch(/fetch\s*\(|XMLHttpRequest/);
    expect(src).not.toMatch(/\/messages\/|messenger\.com/i);
  });

  it("only uses key event names to stop them reaching the page", () => {
    const lines = src.split("\n").filter((line) => /keydown|keyup|keypress/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/stopPropagation/);
  });
});

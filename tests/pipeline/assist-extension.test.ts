import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const ext = path.resolve(__dirname, "../../extension");
type El = {
  tagName: string;
  attrs: Record<string, string>;
  value?: string;
  textContent: string;
  focused?: boolean;
  events: string[];
  getAttribute(name: string): string | null;
  getClientRects(): unknown[];
  focus(): void;
  dispatchEvent(event: { type: string; data?: string }): boolean;
};
const assist = require(path.join(ext, "assist.js")) as {
  isFacebookUrl(url: string): boolean;
  postKey(url: string): string;
  findCommentBox(doc: unknown): El | null;
  insertReply(doc: unknown, el: El, text: string): boolean;
  MAX_TEXT: number;
};

function el(tagName: string, attrs: Record<string, string>, opts: { hidden?: boolean; acceptsBeforeInput?: boolean } = {}): El {
  const node: El = {
    tagName,
    attrs,
    textContent: "",
    events: [],
    getAttribute: (name) => attrs[name] ?? null,
    getClientRects: () => (opts.hidden ? [] : [{}]),
    focus() {
      node.focused = true;
    },
    dispatchEvent(event) {
      node.events.push(event.type);
      if (event.type === "beforeinput" && opts.acceptsBeforeInput) node.textContent += event.data ?? "";
      return true;
    },
  };
  if (tagName === "TEXTAREA") node.value = "";
  return node;
}

class FakeEvent {
  constructor(public type: string, init?: { data?: string }) {
    Object.assign(this, init);
  }
}

function doc(nodes: El[], execCommand?: (cmd: string, ui: boolean, value: string) => boolean) {
  return {
    querySelectorAll: () => nodes,
    defaultView: { Event: FakeEvent, InputEvent: FakeEvent },
    execCommand,
  };
}

describe("assist extension helpers", () => {
  it("accepts only https facebook URLs", () => {
    expect(assist.isFacebookUrl("https://www.facebook.com/groups/1/posts/2")).toBe(true);
    expect(assist.isFacebookUrl("http://www.facebook.com/groups/1/posts/2")).toBe(false);
    expect(assist.isFacebookUrl("https://evilfacebook.com/x")).toBe(false);
    expect(assist.isFacebookUrl("https://facebook.com.evil.io/x")).toBe(false);
  });

  it("derives a stable post key across URL shapes", () => {
    expect(assist.postKey("https://www.facebook.com/groups/1/posts/123/")).toBe("123");
    expect(assist.postKey("https://www.facebook.com/groups/1/permalink/123/")).toBe("123");
    expect(assist.postKey("https://www.facebook.com/groups/1/?multi_permalinks=123,456")).toBe("123");
    expect(assist.postKey("https://www.facebook.com/permalink.php?story_fbid=999&id=1")).toBe("999");
    expect(assist.postKey("https://example.com/posts/1")).toBe("");
  });

  it("picks the comment box and never a Messenger or search box", () => {
    const chat = el("DIV", { "aria-label": "Message Somchai" });
    const search = el("DIV", { "aria-label": "Search Facebook" });
    const hidden = el("DIV", { "aria-label": "Write a comment…" }, { hidden: true });
    const comment = el("DIV", { "aria-label": "เขียนความคิดเห็น…" });
    expect(assist.findCommentBox(doc([chat, search, hidden, comment]))).toBe(comment);
    expect(assist.findCommentBox(doc([chat, search]))).toBeNull();
    expect(assist.findCommentBox(doc([el("DIV", {})]))).toBeNull();
  });

  it("inserts into a textarea without key events", () => {
    const box = el("TEXTAREA", { placeholder: "Write a comment" });
    expect(assist.insertReply(doc([box]), box, "สนใจครับ ทักแชทได้เลย")).toBe(true);
    expect(box.value).toBe("สนใจครับ ทักแชทได้เลย");
    expect(box.events).toEqual(["input"]);
  });

  it("uses execCommand insertText, then a beforeinput fallback, and caps length", () => {
    const box = el("DIV", { "aria-label": "Write a comment" });
    const calls: string[] = [];
    const ok = assist.insertReply(
      doc([box], (cmd, _ui, value) => {
        calls.push(cmd);
        box.textContent += value;
        return true;
      }),
      box,
      "x".repeat(5000),
    );
    expect(ok).toBe(true);
    expect(calls).toEqual(["insertText"]);
    expect(box.textContent).toHaveLength(assist.MAX_TEXT);
    expect(box.focused).toBe(true);

    const box2 = el("DIV", { "aria-label": "Write a comment" }, { acceptsBeforeInput: true });
    expect(assist.insertReply(doc([box2], () => false), box2, "hello there")).toBe(true);
    expect(box2.events).toEqual(["beforeinput"]);
  });
});

describe("extension safety policy", () => {
  const code = (file: string) =>
    readFileSync(path.join(ext, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it.each(["assist.js", "bridge.js", "background.js", "content.js", "identity.js", "scrape.js", "parser.js", "selectors.js", "popup.js"])("%s never clicks, presses keys, submits or calls GraphQL", (file) => {
    const src = code(file);
    expect(src).not.toMatch(/\.click\s*\(/);
    expect(src).not.toMatch(/["']Enter["']|keydown|keypress|keyup|KeyboardEvent/);
    expect(src).not.toMatch(/submit/i);
    expect(src).not.toMatch(/graphql/i);
    expect(src).not.toMatch(/\/messages\/|messenger\.com/i);
  });

  it("reads Marketplace pages with the same read-only content script", () => {
    const manifest = JSON.parse(readFileSync(path.join(ext, "manifest.json"), "utf8")) as { content_scripts: { matches: string[]; js: string[] }[] };
    const reader = manifest.content_scripts.find((entry) => entry.js.includes("content.js"))!;
    expect(reader.matches).toContain("https://www.facebook.com/marketplace/*");
    expect(reader.js).not.toContain("assist.js");
  });

  it("only exposes the bridge to the local MY-BOT app or an HTTPS Render deployment", () => {
    const manifest = JSON.parse(readFileSync(path.join(ext, "manifest.json"), "utf8")) as { content_scripts: { matches: string[]; js: string[] }[] };
    for (const script of manifest.content_scripts.filter((entry) => entry.js.includes("bridge.js"))) {
      for (const match of script.matches) expect(match).toMatch(/^(http:\/\/(localhost|127\.0\.0\.1)\/|https:\/\/\*\.onrender\.com\/)/);
    }
  });

  it("version 1.5 registers only the mark-sent / skip shortcuts", () => {
    const manifest = JSON.parse(readFileSync(path.join(ext, "manifest.json"), "utf8")) as {
      version: string;
      commands: Record<string, { suggested_key?: { default?: string } }>;
      permissions: string[];
    };
    expect(manifest.version).toBe("1.5.0");
    expect(manifest.permissions).not.toContain("cookies");
    expect(manifest.permissions).not.toContain("webRequest");
    expect(Object.keys(manifest.commands).sort()).toEqual(["mark-sent", "mark-skip"]);
    expect(manifest.commands["mark-sent"].suggested_key?.default).toBe("Alt+Shift+S");
    expect(manifest.commands["mark-skip"].suggested_key?.default).toBe("Alt+Shift+K");
    expect(manifest.permissions).not.toContain("debugger");
  });

  it("background talks only to MY-BOT and trusts tab ids it recorded itself", () => {
    const src = code("background.js");
    expect(src).toMatch(/\/api\/v1\/extension\/reply-queue/);
    expect(src).toMatch(/files: \["assist\.js", "overlay\.js"\]/);
    expect(src).toMatch(/loadAssistTabs\(\)/);
    expect(src).not.toMatch(/facebook\.com\/api|fetch\([^)]*facebook/i);
  });

  it("background only injects for a pending request from the MY-BOT origin", () => {
    const src = code("background.js");
    expect(src).toMatch(/fromMyBotApp/);
    expect(src).toMatch(/chrome\.storage\.session/);
  });
});

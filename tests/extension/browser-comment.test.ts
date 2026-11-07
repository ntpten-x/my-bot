import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
const { action } = createRequire(import.meta.url)("../../extension/browser-comment.js") as { action(kind: string, payload: Record<string, unknown>, env: Record<string, unknown>): Promise<{ ok: boolean; outcome?: string; commentUrl?: string }> };
const url = "https://www.facebook.com/groups/12345/posts/8888/";
const payload = { id: "job", externalUrl: url, message: "ข้อความทดสอบ", fbUserId: "99887766" };
function fixture(html?: string) {
  const dom = new JSDOM(html ?? '<main role="main"><article role="article"><a href="/groups/12345/posts/8888/">post</a><form><textarea aria-label="Write a comment"></textarea><button type="button" aria-label="Comment">Comment</button></form></article></main>', { url });
  dom.window.document.cookie = "c_user=99887766";
  const click = vi.fn(); dom.window.document.querySelector("button")?.addEventListener("click", click);
  const env = { document: dom.window.document, location: { href: url }, visible: () => true, now: () => 1000, memory: {} };
  return { dom, env, click, doc: dom.window.document };
}
describe("browser DOM delivery using SYNTHETIC pages only", () => {
  it("prepares without clicking and clicks once only with a fresh permit", async () => {
    const f = fixture(); expect(await action("prepare", payload, f.env)).toMatchObject({ ok: true }); expect(f.click).not.toHaveBeenCalled();
    expect(await action("send", { ...payload, permitUntil: 2000 }, f.env)).toMatchObject({ ok: true });
    expect(await action("send", { ...payload, permitUntil: 2000 }, f.env)).toMatchObject({ ok: false }); expect(f.click).toHaveBeenCalledTimes(1);
    f.dom.window.close();
  });
  it.each([0, 999, 1000, 5000])("refuses missing, expired or excessive permits: %i", async permitUntil => {
    const f = fixture(); await action("prepare", payload, f.env);
    expect((await action("send", { ...payload, permitUntil }, f.env)).ok).toBe(false); expect(f.click).not.toHaveBeenCalled(); f.dom.window.close();
  });
  it("refuses wrong account or post", async () => {
    const f = fixture(); expect((await action("prepare", { ...payload, fbUserId: "111111" }, f.env)).ok).toBe(false);
    expect((await action("prepare", { ...payload, externalUrl: url.replace("8888", "9999") }, f.env)).ok).toBe(false); expect(f.click).not.toHaveBeenCalled(); f.dom.window.close();
  });
  it("stops at checkpoints and refuses ambiguous composers", async () => {
    const f = fixture(); f.doc.body.appendChild(f.doc.createElement("iframe")).src = "https://www.facebook.com/captcha";
    expect(await action("prepare", payload, f.env)).toMatchObject({ outcome: "blocked" }); expect(f.click).not.toHaveBeenCalled(); f.dom.window.close();
    const duplicate = fixture(); duplicate.doc.querySelector("form")!.appendChild(duplicate.doc.querySelector("textarea")!.cloneNode());
    expect((await action("prepare", payload, duplicate.env)).ok).toBe(false); expect(duplicate.click).not.toHaveBeenCalled(); duplicate.dom.window.close();
  });
  it("does not overwrite an owner's draft or use reply/message boxes", async () => {
    const f = fixture(); f.doc.querySelector("textarea")!.value = "owner draft";
    expect((await action("prepare", payload, f.env)).ok).toBe(false); expect(f.doc.querySelector("textarea")!.value).toBe("owner draft");
    f.doc.querySelector("textarea")!.value = ""; f.doc.querySelector("textarea")!.setAttribute("aria-label", "Reply comment");
    expect((await action("prepare", payload, f.env)).ok).toBe(false); f.dom.window.close();
  });
  it("observes only a new comment with own author and post-specific link", async () => {
    const f = fixture(); await action("prepare", payload, f.env); await action("send", { ...payload, permitUntil: 2000 }, f.env);
    expect(await action("observe", payload, f.env)).toMatchObject({ outcome: "uncertain" });
    const comment = f.doc.createElement("div"); comment.setAttribute("role", "article");
    comment.innerHTML = '<a href="/99887766">Owner</a><span>ข้อความทดสอบ</span><a href="/groups/12345/posts/8888/?comment_id=777">time</a>';
    f.doc.querySelector("article")!.appendChild(comment);
    expect(await action("observe", payload, f.env)).toMatchObject({ ok: true, outcome: "observed", commentUrl: url + "?comment_id=777" }); f.dom.window.close();
  });
});

it("supports a uniquely identified target dialog with a Thai main composer", async () => {
  const f = fixture('<div role="dialog"><a href="/groups/12345/posts/8888/">target</a><form><textarea aria-label="เขียนความคิดเห็นที่แสดงต่อสาธารณะ..."></textarea><button type="button" aria-label="ส่ง">ส่ง</button></form></div>');
  expect(await action("prepare", payload, f.env)).toMatchObject({ ok: true });
  expect(f.click).not.toHaveBeenCalled();
  expect(await action("send", { ...payload, permitUntil: 2000 }, f.env)).toMatchObject({ ok: true });
  expect(f.click).toHaveBeenCalledTimes(1); f.dom.window.close();
});
it("refuses multiple independent dialog composers", async () => {
  const html = '<div role="dialog"><a href="/groups/12345/posts/8888/">target</a><form><textarea aria-label="Write a comment"></textarea><button aria-label="Comment">Comment</button></form></div>';
  for (const value of [html + html]) {
    const f = fixture(value); expect((await action("prepare", payload, f.env)).ok).toBe(false); expect(f.click).not.toHaveBeenCalled(); f.dom.window.close();
  }
});

it("supports nested post dialogs sharing one composer without a permalink anchor", async () => {
 const f=fixture('<div role="dialog"><div role="dialog"><form><textarea aria-label="เขียนความคิดเห็นที่แสดงต่อสาธารณะ..."></textarea><button type="button" aria-label="ส่ง">ส่ง</button></form></div></div>');
 expect((await action("prepare",payload,f.env)).ok).toBe(true);
 expect(f.click).not.toHaveBeenCalled(); f.dom.window.close();
});

it("places the selection inside the contenteditable before inserting text", async () => {
  const f = fixture('<main role="main"><article role="article"><a href="/groups/12345/posts/8888/">post</a><form><div contenteditable="true" role="textbox" aria-label="Write a comment"><p><br></p></div><button type="button" aria-label="Comment">Comment</button></form></article></main>');
  const box = f.doc.querySelector('[contenteditable]')!;
  Object.defineProperty(f.doc, 'execCommand', { value: vi.fn((_command, _ui, text) => {
    expect(box.contains(f.doc.getSelection()!.anchorNode)).toBe(true);
    box.textContent = text; return true;
  }) });
  expect((await action('prepare', payload, f.env)).ok).toBe(true);
  expect(f.click).not.toHaveBeenCalled(); f.dom.window.close();
});
it("fails without a false success when a controlled editor rejects input", async () => {
  const f = fixture('<main><article role="article"><a href="/groups/12345/posts/8888/">post</a><form><div contenteditable="true" role="textbox" aria-label="Write a comment"></div><button aria-label="Comment">Comment</button></form></article></main>');
  Object.defineProperty(f.doc, 'execCommand', { value: () => false });
  expect(await action('prepare', payload, f.env)).toMatchObject({ ok: false, reason: 'editor_text_not_accepted' });
  expect(f.click).not.toHaveBeenCalled(); f.dom.window.close();
});

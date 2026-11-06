// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommentRulePreview } from "../../src/components/comment-rule-preview";

let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ matched: false, checks: [{ code: "enabled", label: "กฎเปิดใช้งาน", passed: false }], evaluatedAt: "2026-11-02T03:00:00Z" }), { status: 200 })));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("only previews explicit synthetic input and clears old results after editing", async () => {
  await act(async () => root.render(React.createElement(CommentRulePreview, { rules: [{ id: "rule", name: "ทดสอบ" }], sources: [{ id: "source", name: "กลุ่มทดสอบ" }] })));
  const button = container.querySelector("button")!;
  expect(button.disabled).toBe(true); expect(fetch).not.toHaveBeenCalled();
  for (const [id, value] of [["preview-rule", "rule"], ["preview-source", "source"]]) {
    await act(async () => { const select = container.querySelector<HTMLSelectElement>(`#${id}`)!; select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  }
  const textarea = container.querySelector<HTMLTextAreaElement>("#preview-text")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { setValue.call(textarea, "หาช่างแอร์"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("/api/auto-comment/preview", expect.objectContaining({ method: "POST", body: JSON.stringify({ ruleId: "rule", sourceId: "source", text: "หาช่างแอร์" }) }));
  expect(container.querySelector('[role="status"]')?.textContent).toContain("ไม่ผ่านเงื่อนไข");
  expect(container.textContent).toContain("ไม่อนุญาตให้ส่งจริง");
  await act(async () => { setValue.call(textarea, "อื่น ๆ"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(container.querySelector('[role="status"]')).toBeNull();
});

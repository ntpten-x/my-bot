// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommentEvidence } from "../../src/components/comment-evidence";
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("shows uncertain review instructions without mutation controls and makes only one GET", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({
    job: { id: "job", status: "uncertain", message: "ข้อความเดิม", deliveryMode: "extension", attempts: 1, dryRun: false },
    targetUrl: "https://www.facebook.com/groups/test/posts/123/", commentUrl: null, account: { id: "42", name: "บัญชีเจ้าของ" },
    stages: [{ key: "dispatch", label: "อนุญาตการส่ง", at: null, timing: "missing", elapsedFromIngestMs: null, waitFromPreviousMs: null }], logs: [], ai: null, evaluation: null, processing: { state: "done" }, coverage: { truncated: true, totalLogs: 101, returnedLogs: 100, browserCommentUrlNotPersisted: true },
  })));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(React.createElement(CommentEvidence, { jobId: "job" })));
  expect(container.textContent).toContain("ไม่ส่งซ้ำ"); expect(container.textContent).toContain("บัญชีเจ้าของ"); expect(container.textContent).toContain("ไม่ทราบ"); expect(container.textContent).toContain("101");
  expect(container.textContent).toContain("popup");
  expect(container.querySelectorAll("button")).toHaveLength(0);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe("/api/auto-comment/jobs/job/evidence");
});

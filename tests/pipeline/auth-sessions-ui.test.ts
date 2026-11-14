// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AuthSessions } from "../../src/components/auth-sessions";
afterEach(() => vi.unstubAllGlobals());
it("shows the current browser and revokes another session without exposing tokens", async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let revoked = false;
  const row = { createdAt: "2026-11-14T00:00:00Z", expiresAt: "2026-12-14T00:00:00Z" };
  const fetcher = vi.fn(async (_url, init) => {
    if (init?.method === "DELETE") { revoked = true; return Response.json({ ok: true }); }
    return Response.json({ sessions: [{ ...row, id: "current", current: true }, ...(!revoked ? [{ ...row, id: "other", current: false }] : [])] });
  });
  vi.stubGlobal("fetch", fetcher);
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(AuthSessions, { refreshKey: 0 })));
    expect(container.textContent).toContain("เครื่องนี้");
    const buttons = [...container.querySelectorAll("button")].filter(button => button.textContent === "ออกจากระบบอุปกรณ์นี้");
    expect(buttons).toHaveLength(1);
    await act(async () => buttons[0].click());
    expect(fetcher).toHaveBeenCalledWith("/api/auth/sessions", expect.objectContaining({ method: "DELETE", body: '{"id":"other"}' }));
    expect(container.querySelectorAll("li")).toHaveLength(1);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

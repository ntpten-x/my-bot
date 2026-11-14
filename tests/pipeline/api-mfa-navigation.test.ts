import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../../src/components/api";

afterEach(() => vi.unstubAllGlobals());

function deniedAt(pathname: string, code: string) {
  const location = { pathname, href: `https://mybot.example${pathname}?from=login#enroll` };
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { location, dispatchEvent });
  vi.stubGlobal("fetch", async () => Response.json({ error: "authentication required", code }, { status: 403 }));
  return { location, dispatchEvent };
}

it("keeps MFA enrollment on the current security page when background requests are denied", async () => {
  const { location } = deniedAt("/settings/security", "MFA_SETUP_REQUIRED");
  const original = location.href;

  await expect(api("/api/notifications?countOnly=1")).rejects.toBeInstanceOf(ApiError);

  expect(location.href).toBe(original);
});

it("directs an unenrolled owner from other pages to security without accepting the denied request", async () => {
  const { location } = deniedAt("/settings", "MFA_SETUP_REQUIRED");

  await expect(api("/api/settings")).rejects.toThrow("authentication required");

  expect(location.href).toBe("/settings/security");
});

it("opens recent-auth confirmation without navigating away from an in-progress form", async () => {
  const { location, dispatchEvent } = deniedAt("/settings", "REAUTH_REQUIRED");
  const original = location.href;

  await expect(api("/api/settings", { method: "PUT", body: "{}" })).rejects.toBeInstanceOf(ApiError);

  expect(location.href).toBe(original);
  expect(dispatchEvent).toHaveBeenCalledOnce();
  expect(dispatchEvent.mock.calls[0][0].type).toBe("mybot:reauth-required");
});

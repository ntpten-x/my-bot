import { expect, it } from "vitest";
import { publicBuildHeaders } from "../../src/lib/build-info";
import { publicHealth } from "../../src/lib/version";
import { GET } from "../../src/app/api/v1/health/route";

it("reports public release identifiers without changing the minimal health body", () => {
  expect(publicBuildHeaders({ RENDER_GIT_COMMIT: "086b481aa4921438e52b1c5035d0f892b0fb04e4" })).toMatchObject({
    "X-MYBOT-Desktop-Version": "0.1.4-preview", "X-MYBOT-Extension-Version": "1.11.21",
    "X-MYBOT-Commit": "086b481aa492", "Cache-Control": "no-store",
  });
  expect(Object.keys(publicHealth()).sort()).toEqual(["ok", "version"]);
});
it("does not expose unexpected environment values as build identifiers", () => {
  for (const value of [undefined, "secret-value", "https://user:password@example.invalid", "invalid\r\nHeader: value"]) {
    expect(publicBuildHeaders({ RENDER_GIT_COMMIT: value })).not.toHaveProperty("X-MYBOT-Commit");
  }
});
it("attaches release headers to the public health response without leaking additional body fields", async () => {
  const response = GET();
  expect(await response.json()).toEqual(publicHealth());
  expect(response.headers.get("X-MYBOT-Desktop-Version")).toBe("0.1.4-preview");
  expect(response.headers.get("X-MYBOT-Extension-Version")).toBe("1.11.21");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

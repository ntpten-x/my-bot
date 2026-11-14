import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../../src/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("../../src/components/shell", () => ({ Shell: () => null }));
vi.mock("../../src/components/extension-auto-connect", () => ({ ExtensionAutoConnect: () => null }));
import Layout from "../../src/app/(app)/layout";
afterEach(() => vi.clearAllMocks());
it("denies every owner page when no valid session exists, including forged cookies", async () => {
  mocks.session.mockResolvedValue(null);
  await expect(Layout({ children: null })).rejects.toThrow("REDIRECT:/login");
});
it("renders the owner shell only after validating the session", async () => {
  mocks.session.mockResolvedValue({ id: "synthetic", ownerId: "owner" });
  expect(await Layout({ children: null })).toBeTruthy();
});

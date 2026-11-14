import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ post: vi.fn(), notification: vi.fn() }));
vi.mock("../../src/lib/guard", () => ({ authed: async () => ({ error: null }) }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { post: { updateMany: mocks.post }, notification: { updateMany: mocks.notification } } }));
import { POST as posts } from "../../src/app/api/posts/mark-read/route";
import { POST as notifications } from "../../src/app/api/notifications/route";
const request = (body: string) => new Request("http://synthetic.invalid", { method: "POST", body });
beforeEach(() => vi.clearAllMocks());
it("never turns malformed JSON or empty IDs into a mass update", async () => {
  for (const body of ["invalid", "{}", '{"ids":[]}', '{"all":false}']) {
    expect((await posts(request(body))).status).toBe(400);
    expect((await notifications(request(body))).status).toBe(400);
  }
  expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.notification).not.toHaveBeenCalled();
});
it("requires explicit intent to update all notifications", async () => {
  mocks.notification.mockResolvedValue({ count: 1 });
  expect((await notifications(request('{"all":true}'))).status).toBe(200);
  expect(mocks.notification).toHaveBeenCalledWith({ where: { read: false }, data: { read: true } });
});

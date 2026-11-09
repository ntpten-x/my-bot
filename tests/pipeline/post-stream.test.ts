import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), find: vi.fn() }));
vi.mock("../../src/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { post: { findMany: mocks.find } } }));
vi.mock("../../src/lib/serialize", () => ({ postInclude: {}, serializePost: post => ({ id: post.id }) }));
import { GET } from "../../src/app/api/v1/stream/route";

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); mocks.session.mockResolvedValue({ userId: "synthetic" }); });
afterEach(() => vi.useRealTimers());
it("requires the signed-in session before starting database work", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await GET(new Request("http://localhost/api/v1/stream"))).status).toBe(401);
  expect(mocks.find).not.toHaveBeenCalled();
});
it("drains 25 equal-timestamp posts across batches using the ID tie breaker", async () => {
  const at = new Date(Date.now() + 1);
  const posts = Array.from({ length: 25 }, (_, index) => ({ id: `post-${String(index).padStart(2, "0")}`, createdAt: at }));
  mocks.find.mockImplementation(async ({ where, take }) => posts.filter(post => !where.OR || post.id > where.OR[1].id.gt).slice(0, take));
  const abort = new AbortController();
  const response = await GET(new Request("http://localhost/api/v1/stream", { signal: abort.signal }));
  const reader = response.body!.getReader(); const decode = async () => new TextDecoder().decode((await reader.read()).value);
  expect(await decode()).toContain('"type":"hello"');
  const first = JSON.parse((await decode()).slice(6));
  await vi.advanceTimersByTimeAsync(101);
  const second = JSON.parse((await decode()).slice(6));
  expect([...first.posts, ...second.posts].map(post => post.id)).toEqual(posts.map(post => post.id));
  abort.abort();expect((await reader.read()).done).toBe(true);
  const calls = mocks.find.mock.calls.length;await vi.advanceTimersByTimeAsync(10000);expect(mocks.find).toHaveBeenCalledTimes(calls);
});
it("does not overlap slow polls and discards late results after cancellation", async () => {
  let finish: (value: unknown[]) => void = () => {};
  mocks.find.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const response = await GET(new Request("http://localhost/api/v1/stream"));
  const reader = response.body!.getReader();await reader.read();
  await vi.advanceTimersByTimeAsync(10000);expect(mocks.find).toHaveBeenCalledTimes(1);
  await reader.cancel();finish([]);await vi.advanceTimersByTimeAsync(10000);
  expect(mocks.find).toHaveBeenCalledTimes(1);
});

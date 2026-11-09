import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialPostStreamCursor, POST_STREAM_OVERLAP_MS, postStreamWhere } from "@/lib/post-stream";

const mocks = vi.hoisted(() => ({ session: vi.fn(), find: vi.fn() }));
vi.mock("../../src/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { post: { findMany: mocks.find } } }));
vi.mock("../../src/lib/serialize", () => ({ postInclude: {}, serializePost: (post: { id: string }) => ({ id: post.id }) }));
import { GET } from "../../src/app/api/v1/stream/route";

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); mocks.session.mockResolvedValue({ userId: "synthetic" }); });
afterEach(() => vi.useRealTimers());

it("starts the SSE cursor with a short overlap window", () => {
  const now = Date.parse("2026-11-09T12:00:00+07:00");
  const cursor = initialPostStreamCursor(now);
  expect(cursor.id).toBeNull();
  expect(cursor.createdAt.getTime()).toBe(now - POST_STREAM_OVERLAP_MS);
  expect(POST_STREAM_OVERLAP_MS).toBe(15_000);
  expect(postStreamWhere({ createdAt: new Date(now), id: null })).toMatchObject({ createdAt: { gte: expect.any(Date) } });
});

it("requires the signed-in session before starting database work", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await GET(new Request("http://localhost/api/v1/stream"))).status).toBe(401);
  expect(mocks.find).not.toHaveBeenCalled();
});

it("drains 25 equal-timestamp posts across batches using the ID tie breaker", async () => {
  const at = new Date(Date.now() + 1);
  const posts = Array.from({ length: 25 }, (_, index) => ({ id: `post-${String(index).padStart(2, "0")}`, createdAt: at }));
  mocks.find.mockImplementation(async ({ where, take }: { where: { OR?: Array<{ id?: { gt: string } }> }; take: number }) =>
    posts.filter((post) => !where.OR || post.id > (where.OR[1]?.id?.gt || "")).slice(0, take),
  );
  const abort = new AbortController();
  const response = await GET(new Request("http://localhost/api/v1/stream", { signal: abort.signal }));
  const reader = response.body!.getReader();
  const decode = async () => new TextDecoder().decode((await reader.read()).value);
  expect(await decode()).toContain('"type":"hello"');
  const first = JSON.parse((await decode()).slice(6));
  await vi.advanceTimersByTimeAsync(101);
  const second = JSON.parse((await decode()).slice(6));
  expect([...first.posts, ...second.posts].map((post: { id: string }) => post.id)).toEqual(posts.map((post) => post.id));
  abort.abort();
  expect((await reader.read()).done).toBe(true);
  const calls = mocks.find.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(mocks.find).toHaveBeenCalledTimes(calls);
});

it("does not overlap slow polls and discards late results after cancellation", async () => {
  let finish: (value: unknown[]) => void = () => {};
  mocks.find.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const response = await GET(new Request("http://localhost/api/v1/stream"));
  const reader = response.body!.getReader();
  await reader.read();
  await vi.advanceTimersByTimeAsync(10000);
  expect(mocks.find).toHaveBeenCalledTimes(1);
  await reader.cancel();
  finish([]);
  await vi.advanceTimersByTimeAsync(10000);
  expect(mocks.find).toHaveBeenCalledTimes(1);
});

it("dedupes posts replayed by the overlap window", async () => {
  const at = new Date(Date.now() - 5_000);
  const posts = [{ id: "post-01", createdAt: at }, { id: "post-02", createdAt: at }];
  mocks.find
    .mockResolvedValueOnce(posts)
    .mockResolvedValueOnce(posts)
    .mockResolvedValue([]);
  const abort = new AbortController();
  const response = await GET(new Request("http://localhost/api/v1/stream", { signal: abort.signal }));
  const reader = response.body!.getReader();
  const decode = async () => new TextDecoder().decode((await reader.read()).value);
  expect(await decode()).toContain('"type":"hello"');
  const first = JSON.parse((await decode()).slice(6));
  expect(first.posts.map((post: { id: string }) => post.id)).toEqual(["post-01", "post-02"]);
  const secondPromise = decode();
  await vi.advanceTimersByTimeAsync(2500);
  const second = JSON.parse((await secondPromise).slice(6));
  expect(second.type).toBe("ping");
  abort.abort();
});

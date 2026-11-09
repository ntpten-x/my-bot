import { afterEach, expect, it, vi } from "vitest";
const work = vi.hoisted(() => ({ scan: vi.fn(), prepare: vi.fn() }));
vi.mock("../../src/lib/auto-comment/browser", () => ({ scanBrowserComments: work.scan, prepareBrowserComments: work.prepare }));
vi.mock("../../src/lib/auto-comment/engine", () => ({ credentialsFor: vi.fn(), scanAutoCommentPosts: vi.fn(), processAutoCommentQueue: vi.fn() }));
vi.mock("../../src/lib/auto-comment/control", () => ({ readCommentControl: async () => ({ dryRun: false }), lockCommentControl: vi.fn(), mayRun: vi.fn(), storeCommentControl: vi.fn() }));
vi.mock("../../src/lib/log", () => ({ workerLog: async () => undefined }));
import { autoCommentTick } from "../../src/lib/auto-comment/poll";

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it("runs durable recovery despite a failed scan and releases its in-process guard", async () => {
  vi.stubEnv("MYBOT_PROCESS", "worker");
  work.scan.mockRejectedValueOnce(new Error("synthetic scan failure")).mockResolvedValue(undefined);
  work.prepare.mockResolvedValue(undefined);
  await expect(autoCommentTick(async () => undefined)).rejects.toThrow("synthetic scan failure");
  expect(work.prepare).toHaveBeenCalledTimes(1);
  await autoCommentTick(async () => undefined);
  expect(work.scan).toHaveBeenCalledTimes(2);
  expect(work.prepare).toHaveBeenCalledTimes(2);
});
it("does not bypass a lost worker lease during recovery", async () => {
  vi.stubEnv("MYBOT_PROCESS", "worker");
  work.scan.mockRejectedValue(new Error("scan interrupted"));
  const guard = vi.fn(async () => { throw new Error("lease lost"); });
  const mutate = vi.fn();
  work.prepare.mockImplementation(async (assertActive: () => Promise<void>) => { await assertActive(); mutate(); });
  await expect(autoCommentTick(guard)).rejects.toThrow("lease lost");
  expect(guard).toHaveBeenCalled();
  expect(mutate).not.toHaveBeenCalled();
});

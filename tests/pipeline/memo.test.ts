import { afterEach, expect, it, vi } from "vitest";
import { forget, memo } from "../../src/lib/memo";

afterEach(() => { forget(); vi.useRealTimers(); });

it("shares a slow in-flight read even after its TTL, then caches from completion", async () => {
  vi.useFakeTimers();
  let finish!: (value: string) => void;
  const load = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const first = memo("slow", 1000, load);
  await vi.advanceTimersByTimeAsync(2000);
  const second = memo("slow", 1000, load);
  expect(load).toHaveBeenCalledTimes(1);
  expect(second).toBe(first);
  finish("result");
  await expect(first).resolves.toBe("result");
  await vi.advanceTimersByTimeAsync(999);
  expect(await memo("slow", 1000, load)).toBe("result");
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  memo("slow", 1000, load);
  expect(load).toHaveBeenCalledTimes(2);
  finish("new");
});

it("retries failed reads without retaining a rejected promise", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("ok");
  await expect(memo("retry", 1000, load)).rejects.toThrow("offline");
  await expect(memo("retry", 1000, load)).resolves.toBe("ok");
  expect(load).toHaveBeenCalledTimes(2);
});

it("does not let invalidated in-flight work replace a newer result", async () => {
  let finish!: (value: string) => void;
  const old = memo("fresh", 1000, () => new Promise<string>(resolve => { finish = resolve; }));
  forget("fresh");
  expect(await memo("fresh", 1000, async () => "new")).toBe("new");
  finish("old");
  await old;
  expect(await memo("fresh", 1000, async () => "unexpected")).toBe("new");
});

import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, createHash: vi.fn(actual.createHash) };
});
import { DUPLICATE_WINDOW_MS, findNearDuplicate } from "../../src/lib/smart/vector";

beforeEach(() => { vi.mocked(createHash).mockClear(); });

it("compares already-normalized text without hashing every neighbor in a worker batch", () => {
  const others = Array.from({ length: 400 }, (_, i) => ({
    id: `post-${i}`, sourceId: "group-a", normalizedText: `ตามหาช่างซ่อมบ้าน ${i}`,
    vector: null, createdAt: 1000,
  }));
  expect(findNearDuplicate({ sourceId: "group-a", normalizedText: "ตามหาช่างซ่อมบ้าน 399", vector: null, createdAt: 1000, others }))
    .toEqual({ id: "post-399", reason: "text" });
  expect(createHash).not.toHaveBeenCalled();
});

it("preserves cross-source, short text, empty text, age and first-match boundaries", () => {
  const match = (text: string, sourceId: string, age = 0) => findNearDuplicate({
    sourceId: "group-a", normalizedText: text, vector: null, createdAt: DUPLICATE_WINDOW_MS + 1000,
    others: [{ id: "first", sourceId, normalizedText: text, vector: null, createdAt: DUPLICATE_WINDOW_MS + 1000 - age },
      { id: "second", sourceId, normalizedText: text, vector: null, createdAt: DUPLICATE_WINDOW_MS + 1000 - age }],
  });
  expect(match("ตามหาช่างซ่อมบ้าน", "group-b", DUPLICATE_WINDOW_MS + 1)?.id).toBe("first");
  expect(match("สั้น", "group-b")).toBeNull();
  expect(match("สั้น", "group-a", DUPLICATE_WINDOW_MS)?.id).toBe("first");
  expect(match("สั้น", "group-a", DUPLICATE_WINDOW_MS + 1)).toBeNull();
  expect(match("", "group-a")).toBeNull();
});

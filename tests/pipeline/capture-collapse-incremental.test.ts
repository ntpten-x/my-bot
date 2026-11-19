import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
}));
vi.mock("../../src/lib/prisma", () => ({ prisma: { post: { findMany: db.findMany, update: db.update } } }));
import { collapseTruncatedCapturesForPosts } from "../../src/lib/smart/enrich";

const prefix = "ตามหาผู้รับทำเว็บไซต์สำหรับร้านค้าในกรุงเทพมหานคร งบประมาณหนึ่งหมื่นบาท กรุณาติดต่อ";
const now = new Date("2026-11-19T09:00:00.000Z");
const short = {
  id: "short", sourceId: "source", text: `${prefix} ดูเพิ่มเติม`, externalUrl: "https://example.invalid/short",
  extraUrlsJson: "[]", createdAt: now,
};
const full = {
  id: "full", sourceId: "source", text: `${prefix} พร้อมรายละเอียดเพิ่มเติมและนัดหมาย`,
  externalUrl: "https://example.invalid/full", extraUrlsJson: "[]", createdAt: now,
};

beforeEach(() => {
  db.findMany.mockReset();
  db.update.mockClear();
});

it("checks only the same source and capture window for a newly ingested post", async () => {
  db.findMany
    .mockResolvedValueOnce([short])
    .mockResolvedValueOnce([full, short]);
  expect(await collapseTruncatedCapturesForPosts([short.id])).toBe(1);
  const candidateQuery = db.findMany.mock.calls[1][0];
  expect(candidateQuery.where).toMatchObject({
    duplicateOfId: null,
    sourceId: { in: ["source"] },
    createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
  });
  expect(candidateQuery.select).not.toHaveProperty("createdAt");
  expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: "full" },
    data: expect.objectContaining({ extraUrlsJson: expect.stringContaining("https://example.invalid/short") }),
  }));
  expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: "short" },
    data: { duplicateOfId: "full" },
  }));
});

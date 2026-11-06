import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ source: vi.fn(), poll: vi.fn(), rss: vi.fn(), web: vi.fn() }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { source: { findUnique: mocks.source }, autoCommentRule: { updateMany: mocks.poll } } }));
vi.mock("../../src/lib/guard", () => ({ authed: async () => ({ error: null }) }));
vi.mock("../../src/lib/rss", () => ({ fetchRssPosts: mocks.rss }));
vi.mock("../../src/lib/web-board", () => ({ fetchWebBoardPosts: mocks.web }));
vi.mock("../../src/lib/ingest", () => ({ ingestPosts: vi.fn() }));
import { POST } from "../../src/app/api/sources/[id]/fetch-now/route";
beforeEach(() => { vi.clearAllMocks(); });
it("queues Page reads for the official worker and never invokes HTML scraping", async () => {
  mocks.source.mockResolvedValue({ id: "page-source", type: "facebook_page", enabled: true });
  const response = await POST(new Request("http://localhost:8001/api/sources/page-source/fetch-now", { method: "POST" }), { params: Promise.resolve({ id: "page-source" }) });
  expect(response.status).toBe(200); expect(mocks.poll).toHaveBeenCalledTimes(1); expect(mocks.web).not.toHaveBeenCalled(); expect(mocks.rss).not.toHaveBeenCalled();
});
it("does not queue disabled Page sources", async () => {
  mocks.source.mockResolvedValue({ id: "page-source", type: "facebook_page", enabled: false });
  const response = await POST(new Request("http://localhost:8001/api/sources/page-source/fetch-now", { method: "POST" }), { params: Promise.resolve({ id: "page-source" }) });
  expect(response.status).toBe(409); expect(mocks.poll).not.toHaveBeenCalled(); expect(mocks.web).not.toHaveBeenCalled();
});

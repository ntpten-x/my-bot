import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { postSelect, serializePost, withAlsoIn } from "@/lib/serialize";
import { getSettings } from "@/lib/settings";
import { isListedAd, searchTokens } from "@/lib/smart/search";
import { recordTiming } from "@/lib/metrics";
import { readFollowedProducts } from "@/lib/product-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const started = performance.now();
  try {
  const params = new URL(request.url).searchParams;
  const rawPage = Number(params.get("page") || 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const rawSize = Number(params.get("pageSize") || 30);
  const pageSize = Number.isSafeInteger(rawSize) && rawSize > 0 ? Math.min(rawSize, 100) : 30;
  const where: Prisma.PostWhereInput = {};
  const and: Prisma.PostWhereInput[] = [];

  const categoryId = params.get("categoryId");
  const subcategoryId = params.get("subcategoryId");
  const province = params.get("province");
  const sourceId = params.get("sourceId");
  const intent = params.get("intent");
  const status = params.get("status");
  const from = params.get("from");
  const to = params.get("to");
  if (params.get("hideAds") !== "0") and.push({ isAd: false });
  if (params.get("hideForbidden") !== "0") and.push({ forbiddenHit: false });
  if (params.get("hideDismissed") !== "0") and.push({ dismissed: false });
  if (params.get("hideDuplicates") !== "0") and.push({ duplicateOfId: null });
  // Default: hide posts from paused/disabled sources so old marketplace noise drops out of the feed.
  if (params.get("hideInactiveSources") !== "0") and.push({ source: { enabled: true } });
  if (params.get("followedOnly") === "1") {
    const followed = await readFollowedProducts();
    if (followed.length) and.push({ productId: { in: followed } });
  }
  const minScore = params.get("minScore");
  if (minScore) and.push({ score: { gte: Number(minScore) } });
  if (params.get("unread") === "1") and.push({ isRead: false });
  if (params.get("saved") === "1") and.push({ isSaved: true });
  if (categoryId) and.push({ categoryId });
  if (subcategoryId) and.push({ subcategoryId });
  const productId = params.get("productId");
  if (productId) and.push({ productId: productId === "none" ? null : productId });
  if (province) and.push({ province });
  if (params.get("area") === "1") {
    const area = (await getSettings()).serviceProvinces;
    if (area.length) and.push({ OR: [{ province: null }, { province: { in: area } }] });
  }
  if (sourceId) and.push({ sourceId });
  if (intent) and.push({ intent });
  if (params.get("pipeline") === "1") and.push({ pipelineStatus: { not: "none" } });
  if (status) and.push({ pipelineStatus: status });
  if (from) and.push({ createdAt: { gte: new Date(from) } });
  if (to) and.push({ createdAt: { lte: new Date(to) } });
  const q = params.get("q")?.trim() ?? "";
  if (and.length) where.AND = and;

  if (q) {
    const tokens = searchTokens(q);
    const needles = tokens.length ? tokens : [q];
    const keywordWhere: Prisma.PostWhereInput = {
      AND: [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          OR: needles.flatMap((token) => [
            { text: { contains: token, mode: "insensitive" } },
            { normalizedText: { contains: token.toLowerCase(), mode: "insensitive" } },
            { authorName: { contains: token, mode: "insensitive" } },
          ]),
        },
      ],
    };
    {
      const [total, posts] = await Promise.all([
        prisma.post.count({ where: keywordWhere }),
        prisma.post.findMany({ where: keywordWhere, select: postSelect, relationLoadStrategy: "join", orderBy: [{ isAd: "asc" }, { score: "desc" }, { createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return json({ posts: await withAlsoIn(posts.map(serializePost)), total, page, pageSize, semantic: false, searchScope: "ค้นด้วยคำจากโพสต์ทั้งหมดที่ตรงตัวกรอง" });
    }
  }
  const sortParam = params.get("sort");
  // Default: newest post first (post time, falling back to capture time).
  const sort: Prisma.PostOrderByWithRelationInput[] =
    sortParam === "score"
      ? [{ isAd: "asc" }, { score: "desc" }, { createdAt: "desc" }, { id: "asc" }]
      : sortParam === "captured"
        ? [{ createdAt: "desc" }, { id: "asc" }]
        : [{ sortAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }];
  const [total, posts] = await Promise.all([
    prisma.post.count({ where }),
    prisma.post.findMany({
      where,
      select: postSelect, relationLoadStrategy: "join",
      orderBy: sort,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const visible = [...posts].sort((left, right) => Number(isListedAd(left)) - Number(isListedAd(right)));
  return json({ posts: await withAlsoIn(visible.map(serializePost)), total, page, pageSize, semantic: false });
  } finally { recordTiming("search", performance.now() - started); }
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { postInclude, serializePost, withAlsoIn } from "@/lib/serialize";
import { getSettings } from "@/lib/settings";
import { semanticRank } from "@/lib/smart/enrich";
import { isListedAd, rankHybrid, searchTokens } from "@/lib/smart/search";
import { recordTiming } from "@/lib/metrics";

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
  const minScore = params.get("minScore");
  if (minScore) and.push({ score: { gte: Number(minScore) } });
  if (params.get("unread") === "1") and.push({ isRead: false });
  if (params.get("saved") === "1") and.push({ isSaved: true });
  if (categoryId) and.push({ categoryId });
  if (subcategoryId) and.push({ subcategoryId });
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
  const semantic = params.get("semantic") === "1" && Boolean(q);
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
    if (!semantic) {
      const [total, posts] = await Promise.all([
        prisma.post.count({ where: keywordWhere }),
        prisma.post.findMany({ where: keywordWhere, include: postInclude, orderBy: [{ isAd: "asc" }, { score: "desc" }, { createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return json({ posts: await withAlsoIn(posts.map(serializePost)), total, page, pageSize, semantic: false, searchScope: "ค้นด้วยคำจากโพสต์ทั้งหมดที่ตรงตัวกรอง" });
    }
    const select = { id: true, text: true, isAd: true, embeddingJson: true, embeddingKey: true, embeddingConfig: true } as const;
    const candidateLimit = 1000;
    const [keywordPosts, semanticPosts, keywordTotal, semanticTotal] = await Promise.all([
      prisma.post.findMany({
      where: keywordWhere,
      select,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: candidateLimit,
      }),
      prisma.post.findMany({
          where: { AND: [...(Array.isArray(where.AND) ? where.AND : []), { embeddingJson: { not: "" } }] },
          select,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: candidateLimit,
      }),
      prisma.post.count({ where: keywordWhere }),
      prisma.post.count({ where: { AND: [...(Array.isArray(where.AND) ? where.AND : []), { embeddingJson: { not: "" } }] } }),
    ]);
    const byId = new Map<string, (typeof keywordPosts)[number]>();
    for (const post of [...keywordPosts, ...semanticPosts]) byId.set(post.id, post);
    const pool = [...byId.values()];
    const ranked = await semanticRank(q, await getSettings(), pool);
    // If the model is unavailable, return the complete paginated keyword search.
    if (ranked.warning) {
      const posts = await prisma.post.findMany({ where: keywordWhere, include: postInclude, orderBy: [{ score: "desc" }, { createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize });
      return json({ posts: await withAlsoIn(posts.map(serializePost)), total: keywordTotal, page, pageSize, semantic: false, searchScope: "โมเดลค้นตามความหมายไม่พร้อม จึงค้นด้วยคำจากโพสต์ทั้งหมดที่ตรงตัวกรอง" });
    }
    const keywordIds = new Set(keywordPosts.map(post => post.id));
    const ordered = rankHybrid(q, pool.filter(post => ranked.scores.has(post.id) || keywordIds.has(post.id)), ranked.scores);
    const slice = ordered.slice((page - 1) * pageSize, page * pageSize);
    const full = await prisma.post.findMany({ where: { id: { in: slice.map(post => post.id) } }, include: postInclude });
    const byFullId = new Map(full.map(post => [post.id, post]));
    return json({
      posts: await withAlsoIn(slice.flatMap(post => { const row = byFullId.get(post.id); return row ? [serializePost(row)] : []; })),
      total: ordered.length,
      page,
      pageSize,
      semantic: semantic && !ranked.warning,
      totalIsLimited: keywordTotal > candidateLimit || semanticTotal > candidateLimit,
      searchScope: keywordTotal > candidateLimit || semanticTotal > candidateLimit
        ? `ผลรวมเฉพาะชุดที่ค้น: โพสต์ตรงคำล่าสุดไม่เกิน ${candidateLimit} รายการ และโพสต์มีเวกเตอร์ล่าสุดไม่เกิน ${candidateLimit} รายการตามตัวกรอง เลือกวันที่หรือแหล่งข้อมูลเพื่อค้นช่วงอื่น`
        : "ค้นจากโพสต์ทั้งหมดที่ตรงคำและโพสต์ที่มีเวกเตอร์เข้ากันได้ตามตัวกรอง",
    });
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
      include: postInclude,
      orderBy: sort,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const visible = [...posts].sort((left, right) => Number(isListedAd(left)) - Number(isListedAd(right)));
  return json({ posts: await withAlsoIn(visible.map(serializePost)), total, page, pageSize, semantic: false });
  } finally { recordTiming("search", performance.now() - started); }
}

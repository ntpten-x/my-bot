import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { postInclude, serializePost } from "@/lib/serialize";
import { getSettings } from "@/lib/settings";
import { semanticRank } from "@/lib/smart/enrich";
import { rankHybrid, searchTokens } from "@/lib/smart/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number(params.get("page") || 1));
  const pageSize = 30;
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
            { text: { contains: token } },
            { normalizedText: { contains: token.toLowerCase() } },
            { authorName: { contains: token } },
          ]),
        },
      ],
    };
    const keywordPosts = await prisma.post.findMany({
      where: keywordWhere,
      include: postInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const semanticPosts = semantic
      ? await prisma.post.findMany({
          where: { AND: [...(Array.isArray(where.AND) ? where.AND : []), { embeddingJson: { not: "" } }] },
          include: postInclude,
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : [];
    const byId = new Map<string, (typeof keywordPosts)[number]>();
    for (const post of [...keywordPosts, ...semanticPosts]) byId.set(post.id, post);
    const pool = [...byId.values()];
    const ranked = semantic ? await semanticRank(q, await getSettings(), pool) : { warning: "", scores: new Map<string, number>() };
    const ordered = rankHybrid(q, pool, ranked.scores);
    const slice = ordered.slice((page - 1) * pageSize, page * pageSize);
    return json({
      posts: slice.map(serializePost),
      total: ordered.length,
      page,
      pageSize,
      semantic: semantic && !ranked.warning,
    });
  }
  const sort = params.get("sort") === "score" ? [{ score: "desc" as const }, { createdAt: "desc" as const }] : [{ createdAt: "desc" as const }];
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
  return json({ posts: posts.map(serializePost), total, page, pageSize, semantic: false });
}

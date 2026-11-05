import { prisma } from "./prisma";
import { extractContacts } from "./pipeline/contacts";

type Ref = { id: string; name: string; slug: string } | null;
type SourceRef = { id: string; name: string; url: string; type: string } | null;

export type PostRecord = {
  id: string;
  text: string;
  authorName: string;
  externalUrl: string;
  postedAt: Date | null;
  createdAt: Date;
  imagesJson: string;
  intent: string;
  province: string | null;
  isAd: boolean;
  isRead: boolean;
  isSaved: boolean;
  forbiddenHit: boolean;
  keywordHitsJson: string;
  pipelineStatus: string;
  suggestedReply: string;
  aiProvider: string | null;
  score: number;
  scoreReason: string;
  duplicateOfId: string | null;
  dismissed: boolean;
  extraUrlsJson?: string;
  ocrText?: string;
  followUpAt?: Date | null;
  statusChangedAt?: Date | null;
  repliedAt?: Date | null;
  category: Ref;
  subcategory: Ref;
  product?: Ref;
  productBy?: string;
  source: SourceRef;
  notes?: { id: string; body: string; createdAt: Date }[];
};

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function serializePost(post: PostRecord) {
  return {
    id: post.id,
    text: post.text,
    authorName: post.authorName,
    externalUrl: post.externalUrl,
    postedAt: post.postedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    images: parseJsonArray(post.imagesJson),
    intent: post.intent,
    province: post.province,
    isAd: post.isAd,
    isRead: post.isRead,
    isSaved: post.isSaved,
    forbiddenHit: post.forbiddenHit,
    keywordHits: parseJsonArray(post.keywordHitsJson),
    pipelineStatus: post.pipelineStatus,
    suggestedReply: post.suggestedReply,
    aiProvider: post.aiProvider,
    score: post.score ?? 0,
    scoreReason: post.scoreReason ?? "",
    duplicateOfId: post.duplicateOfId ?? null,
    dismissed: post.dismissed ?? false,
    extraUrls: parseJsonArray(post.extraUrlsJson ?? "[]"),
    contacts: extractContacts(`${post.text}\n${post.ocrText ?? ""}`),
    followUpAt: post.followUpAt?.toISOString() ?? null,
    statusChangedAt: post.statusChangedAt?.toISOString() ?? null,
    repliedAt: post.repliedAt?.toISOString() ?? null,
    alsoIn: [] as AlsoIn[],
    category: post.category,
    subcategory: post.subcategory,
    product: post.product ?? null,
    productBy: post.productBy ?? "",
    source: post.source,
    notes: (post.notes ?? []).map((note) => ({
      id: note.id,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
    })),
  };
}

export const postInclude = {
  category: true,
  subcategory: true,
  product: { select: { id: true, name: true, slug: true } },
  source: true,
  notes: { orderBy: { createdAt: "asc" as const } },
};

export type AlsoIn = { id: string; url: string; source: string };

// The same request is often cross-posted to several groups; duplicates point at the first copy.
export async function withAlsoIn<T extends { id: string; alsoIn: AlsoIn[] }>(posts: T[]): Promise<T[]> {
  if (!posts.length) return posts;
  const copies = await prisma.post.findMany({
    where: { duplicateOfId: { in: posts.map((post) => post.id) } },
    select: { id: true, duplicateOfId: true, externalUrl: true, source: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  if (!copies.length) return posts;
  const byLead = new Map<string, AlsoIn[]>();
  for (const copy of copies) {
    if (!copy.duplicateOfId) continue;
    const list = byLead.get(copy.duplicateOfId) ?? [];
    if (list.length < 10) list.push({ id: copy.id, url: copy.externalUrl, source: copy.source?.name ?? "" });
    byLead.set(copy.duplicateOfId, list);
  }
  return posts.map((post) => (byLead.has(post.id) ? { ...post, alsoIn: byLead.get(post.id)! } : post));
}

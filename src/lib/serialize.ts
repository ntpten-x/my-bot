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
  category: Ref;
  subcategory: Ref;
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
    category: post.category,
    subcategory: post.subcategory,
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
  source: true,
  notes: { orderBy: { createdAt: "asc" as const } },
};

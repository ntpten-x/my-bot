export type Lead = {
  id: string;
  text: string;
  authorName: string;
  externalUrl: string;
  postedAt: string | null;
  createdAt: string;
  images: string[];
  intent: "buyer" | "seller" | "unknown";
  province: string | null;
  isAd: boolean;
  isRead: boolean;
  isSaved: boolean;
  forbiddenHit: boolean;
  keywordHits: string[];
  pipelineStatus: string;
  suggestedReply: string;
  aiProvider: string | null;
  score: number;
  scoreReason: string;
  duplicateOfId: string | null;
  dismissed: boolean;
  category: { id: string; name: string; slug: string } | null;
  subcategory: { id: string; name: string; slug: string } | null;
  source: { id: string; name: string; url: string; type: string } | null;
  notes: { id: string; body: string; createdAt: string }[];
};

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  matchWords: string;
};

export type SourceRow = {
  id: string;
  type: string;
  name: string;
  url: string;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastExtensionAt: string | null;
  lastError: string | null;
  intervalMinutes: number;
  postCount: number;
  logs: { id: string; status: string; message: string; postsFound: number; createdAt: string }[];
};

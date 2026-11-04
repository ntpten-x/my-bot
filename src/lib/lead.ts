export type Lead = {
  id: string;
  text: string;
  authorName: string;
  externalUrl: string;
  postedAt: string | null;
  createdAt: string;
  images: string[];
  intent: "buyer" | "seller" | "ad" | "unknown";
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
  extraUrls: string[];
  contacts?: { type: "phone" | "line" | "link"; value: string; href: string }[];
  followUpAt?: string | null;
  statusChangedAt?: string | null;
  repliedAt?: string | null;
  alsoIn?: { id: string; url: string; source: string }[];
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
  priority: "high" | "normal" | "low";
  currentIntervalMinutes: number;
  maxIntervalMinutes: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunFound: number;
  lastRunNew: number;
  lastRunScrolls: number;
  lastRunStop: string;
  postCount: number;
  logs: { id: string; status: string; message: string; postsFound: number; createdAt: string }[];
};

export type ReplyTemplateRow = {
  id: string;
  name: string;
  body: string;
  categoryId: string | null;
  sortOrder: number;
  useCount: number;
};

export type AutomationRuleRow = {
  id: string;
  name: string;
  enabled: boolean;
  categoryId: string | null;
  keywords: string;
  provinces: string;
  intent: string;
  minScore: number;
  actionNotify: boolean;
  actionSave: boolean;
  actionDismiss: boolean;
  templateId: string | null;
  hitCount: number;
  lastHitAt: string | null;
};

import type { Prisma } from "@prisma/client";
// Historical exports only. Model jobs are never created, claimed or consumed.
export const OBVIOUS_AD_SCORE = 4;
export const STUCK_JOB_MS = 120_000;
export const MAX_AI_ATTEMPTS = 10;
export async function enqueueAiJobs(_postIds: string[], _reset = false) { void _postIds; void _reset;  return 0; }
export async function enqueueUnclassifiedPosts(_reset = false) { void _reset;  return 0; }
export async function repairMissingAiJobs(_limit = 100) { void _limit;  return 0; }
export async function claimAiJobs(_token: string, _db?: Pick<Prisma.TransactionClient, "$queryRaw">) { void _token; void _db;  return []; }
export async function processAiQueue(_assertActive: () => Promise<void> = async () => undefined) { void _assertActive;  return 0; }

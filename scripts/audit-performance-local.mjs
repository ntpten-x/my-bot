import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
try {
  const [posts, providers, jobs, missingVectors, duplicates, feedback, sources, latency] = await Promise.all([
    db.post.count(),
    db.post.groupBy({ by: ['aiProvider'], _count: true }),
    db.aiJob.groupBy({ by: ['status'], _count: true }),
    db.post.count({ where: { embeddingJson: { in: ['', '[]'] } } }),
    db.post.count({ where: { duplicateOfId: { not: null } } }),
    db.feedback.count(),
    db.source.count({ where: { enabled: true } }),
    db.aiJob.aggregate({ where: { status: 'done' }, _avg: { latencyMs: true }, _max: { latencyMs: true } }),
  ]);
  const oldest = await db.aiJob.findFirst({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, attempts: true } });
  console.log(JSON.stringify({ posts, providers, jobs, missingVectors, duplicates, feedback, enabledSources: sources, latency, oldestPending: oldest }, null, 2));
  const pending = await db.aiJob.findMany({ where: { status: 'pending' }, select: { attempts: true, lastError: true, nextAttemptAt: true } });
  console.log(JSON.stringify({ pendingDiagnostics: pending.map(({ attempts, lastError, nextAttemptAt }) => ({ attempts, nextAttemptAt, reason: /timeout|timed out|abort/i.test(lastError) ? 'timeout' : /429|rate limit/i.test(lastError) ? 'rate-limit' : /ไม่มี AI|ยังไม่มี/i.test(lastError) ? 'no-ai' : /โมเดลตอบมา/i.test(lastError) ? 'invalid-ai-output' : lastError ? 'other-error-redacted' : 'none' })) }));
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const response = await fetch('http://127.0.0.1:8001/api/v1/health', { signal: AbortSignal.timeout(5000) });
    await response.text();
    samples.push({ status: response.status, ms: Math.round(performance.now() - start) });
  }
  console.log(JSON.stringify({ publicHealthSamples: samples }));
} finally { await db.$disconnect(); }

import { prisma } from "../src/lib/prisma";
import { getSettings } from "../src/lib/settings";
import { loadCatalogFromDb } from "../src/lib/sources";
import { classifyLeads } from "../src/lib/ai/run";

async function main() {
  const settings = await getSettings();
  const secrets = [settings.groqApiKey, settings.geminiApiKey, settings.extensionToken, settings.discordWebhook, settings.smtpPass, settings.lineToken].filter(Boolean);
  const redact = (text: string) => {
    for (const secret of secrets) text = text.split(secret).join("[redacted]");
    return text.replace(/https?:\/\/\S+/gi, "[url]").replace(/(?:gsk_|AIza|sk-)[\w-]+/g, "[redacted]");
  };
  const rows = await prisma.aiJob.findMany({ where: { status: { in: ["pending", "failed"] } }, select: { status: true, lastError: true, attempts: true }, take: 10 });
  console.log(JSON.stringify({ provider: settings.aiProvider, ollamaModel: settings.ollamaModel, jobs: rows.map(row => ({ status: row.status, attempts: row.attempts, error: redact(row.lastError) })) }, null, 2));
  if (process.argv.includes("--probe")) {
    const jobs = await prisma.aiJob.findMany({ where: { status: { in: ["pending", "failed"] } }, include: { post: true }, take: 5 });
    const { catalog } = await loadCatalogFromDb();
    const start = Date.now();
    const result = await classifyLeads(jobs.map(job => ({ id: job.postId, text: job.post.text })), catalog, settings);
    console.log(JSON.stringify({ probeMs: Date.now() - start, provider: result.provider, results: result.results.length, errors: result.errors.map(row => ({ name: row.name, message: redact(row.message) })) }, null, 2));
  }
}
main().finally(() => prisma.$disconnect());

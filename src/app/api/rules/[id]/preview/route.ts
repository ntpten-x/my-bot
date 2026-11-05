import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { matchRule } from "@/lib/automation";
import { getSettings } from "@/lib/settings";
import { chooseTemplate, queueCandidates } from "@/lib/reply-queue";
import { renderTemplate } from "@/lib/templates";

export const dynamic = "force-dynamic";

// Dry run: which recent posts would this rule have caught? Changes nothing.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const rule = await prisma.automationRule.findUnique({ where: { id } });
  if (!rule) return json({ error: "ไม่พบกฎ" }, 404);
  const posts = await prisma.post.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) }, duplicateOfId: null },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: {
      id: true, text: true, ocrText: true, categoryId: true, subcategoryId: true, province: true, intent: true,
      score: true, isAd: true, forbiddenHit: true, duplicateOfId: true, externalUrl: true, authorName: true, createdAt: true,
      productId: true, sourceId: true, postedAt: true,
    },
  });
  const matched = posts.filter((post) => matchRule({ ...rule, enabled: true }, post));
  // "โพสต์ที่เข้าเงื่อนไขตอนนี้": what the queue would take for this rule now (not replied, not queued yet).
  const now = await queueCandidates(await getSettings(), [{ ...rule, enabled: true, actionQueue: true }]);
  const templates = await prisma.replyTemplate.findMany();
  const usage = new Map<string, number>();
  return json({
    now: now.slice(0, 10).map(({ post }) => {
      const template = chooseTemplate(templates, post, rule, usage);
      return {
        id: post.id,
        authorName: post.authorName,
        text: post.text.slice(0, 160),
        url: post.externalUrl,
        source: post.source?.name ?? "",
        score: post.score,
        template: template?.name ?? "",
        reply: template
          ? renderTemplate(template.body, {
              author: post.authorName, category: post.category?.name, subcategory: post.subcategory?.name,
              province: post.province, source: post.source?.name, product: post.product?.name,
            }).slice(0, 300)
          : post.suggestedReply.slice(0, 300),
      };
    }),
    nowTotal: now.length,
    scanned: posts.length,
    matched: matched.length,
    samples: matched.slice(0, 5).map((post) => ({
      id: post.id,
      authorName: post.authorName,
      text: post.text.slice(0, 160),
      url: post.externalUrl,
      createdAt: post.createdAt.toISOString(),
    })),
  });
}

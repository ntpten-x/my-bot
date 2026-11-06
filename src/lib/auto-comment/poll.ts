import { prisma } from "../prisma";
import { ingestPosts } from "../ingest";
import { credentialsFor, scanAutoCommentPosts, processAutoCommentQueue } from "./engine";
import { facebookGateway, CommentApiError, type CommentGateway } from "./facebook";
import { lockCommentControl, mayRun, readCommentControl, storeCommentControl } from "./control";
import { scanBrowserComments, prepareBrowserComments } from "./browser";

let running = false;
/** Official Page reads only. Group/Marketplace data continues to come from the existing reader. */
export async function autoCommentTick(assertActive: () => Promise<void>, options: { gateway?: CommentGateway } = {}) {
  if (running || process.env.MYBOT_PROCESS !== "worker") return;
  running = true;
  try {
    await prepareBrowserComments(assertActive);
    // Runtime uses browser delivery only. The injected legacy gateway is retained
    // for isolated regression tests of previously stored jobs; no runtime caller supplies it.
    if (!options.gateway) {
      await scanBrowserComments(assertActive);
      await prepareBrowserComments(assertActive);
      return;
    }
    const control = await readCommentControl();
    if (!mayRun(control)) return;
    const rules = await prisma.autoCommentRule.findMany({ where: { deliveryMode: "official", enabled: true, pausedReason: "", pageId: { not: "" }, pageTokenEnc: { not: null }, managerTokenEnc: { not: null }, OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: new Date(Date.now() - 5 * 60_000) } }] }, take: 5 });
    for (const rule of rules) {
      await assertActive();
      if (!mayRun(await readCommentControl())) break;
      try {
        const source = await prisma.source.findUnique({ where: { url: `https://www.facebook.com/${rule.pageId}` } });
        if (!source?.enabled) continue;
        const gateway = options.gateway ?? facebookGateway();
        const credentials = credentialsFor(rule);
        await gateway.verify(credentials);
        const posts = await gateway.posts(credentials);
        await assertActive();
        const latest = await readCommentControl();
        if (!mayRun(latest) || latest.generation !== control.generation) break;
        await ingestPosts({ sourceUrl: `https://www.facebook.com/${rule.pageId}`, actor: "worker", posts: posts.flatMap(post => {
          const match = post.id.match(new RegExp(`^${rule.pageId}_(\\d+)$`));
          if (!match || !post.message || !post.created_time || Date.parse(post.created_time) < Date.parse(control.startedAt)) return [];
          return [{ url: `https://www.facebook.com/${rule.pageId}/posts/${match[1]}`, text: post.message, postedAt: post.created_time }];
        }) });
        await prisma.autoCommentRule.updateMany({ where: { id: rule.id, revision: rule.revision }, data: { lastPolledAt: new Date() } });
      } catch (error) {
        const failure = error instanceof CommentApiError ? error : new CommentApiError("transient", "อ่านเพจไม่สำเร็จ จะตรวจในรอบถัดไป");
        await prisma.$transaction(async tx => {
          const current = await lockCommentControl(tx);
          if (current.generation !== control.generation || !await tx.autoCommentRule.findFirst({ where: { id: rule.id, revision: rule.revision } })) return;
          await tx.autoCommentRule.update({ where: { id: rule.id }, data: { lastPolledAt: new Date(), ...(failure.kind === "permission" ? { pausedReason: failure.message } : {}) } });
          if (failure.kind === "permission" && current.state === "running") await storeCommentControl(tx, { ...current, state: "paused" });
          if (failure.kind === "rate") await storeCommentControl(tx, { ...current, cooldownUntil: new Date(Date.now() + failure.retryAfterMs).toISOString() });
          await tx.autoCommentLog.create({ data: { ruleId: rule.id, event: "read_failed", message: failure.message, pageId: rule.pageId } });
        });
      }
    }
    await scanAutoCommentPosts(assertActive);
    await scanBrowserComments(assertActive);
    await prepareBrowserComments(assertActive);
    await processAutoCommentQueue({ assertActive, gateway: options.gateway });
  } finally { running = false; }
}

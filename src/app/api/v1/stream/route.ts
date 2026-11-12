import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postSelect, serializePost } from "@/lib/serialize";
import { initialPostStreamCursor, postStreamWhere, type PostStreamCursor } from "@/lib/post-stream";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const stop = () => { closed = true; if (timer) clearTimeout(timer); request.signal.removeEventListener("abort", onAbort); };
  let onAbort = () => stop();
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)); }
        catch { stop(); }
      };
      onAbort = () => { stop(); try { controller.close(); } catch { /* Already cancelled. */ } };
      if (request.signal.aborted) { onAbort(); return; }
      request.signal.addEventListener("abort", onAbort, { once: true });
      send({ type: "hello", at: new Date().toISOString() });
      // Start slightly in the past + id dedupe so late-committing rows are not skipped.
      let cursor: PostStreamCursor = initialPostStreamCursor();
      const seen = new Set<string>();
      const poll = async () => {
        if (closed) return;
        let full = false;
        try {
          const posts = await prisma.post.findMany({
            where: postStreamWhere(cursor),
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 20,
            select: postSelect,
          });
          if (closed) return;
          if (posts.length) {
            const last = posts[posts.length - 1];
            cursor = { createdAt: last.createdAt, id: last.id };
            full = posts.length === 20;
            const fresh = posts.filter((post) => {
              if (seen.has(post.id)) return false;
              seen.add(post.id);
              return true;
            });
            while (seen.size > 2000) seen.delete(seen.values().next().value as string);
            if (fresh.length) send({ type: "posts", posts: fresh.map(serializePost) });
            else send({ type: "ping" });
          } else {
            send({ type: "ping" });
          }
        } catch {
          send({ type: "error" });
        }
        finally { if (!closed) timer = setTimeout(() => { void poll(); }, full ? 100 : 2500); }
      };
      void poll(); // Serial polling: a slow query cannot overlap the next one.
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

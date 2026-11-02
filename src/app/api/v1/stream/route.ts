import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postInclude, serializePost } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });

  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      send({ type: "hello", at: new Date().toISOString() });
      let last = new Date();
      timer = setInterval(() => {
        void (async () => {
          try {
            const posts = await prisma.post.findMany({
              where: { createdAt: { gt: last }, duplicateOfId: null, dismissed: false },
              orderBy: { createdAt: "asc" },
              take: 20,
              include: postInclude,
            });
            if (posts.length) {
              last = posts[posts.length - 1].createdAt;
              send({ type: "posts", posts: posts.map(serializePost) });
            } else {
              send({ type: "ping" });
            }
          } catch {
            send({ type: "error" });
          }
        })();
      }, 2500);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
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

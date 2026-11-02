import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { mineSuggestions } from "@/lib/smart/keywords";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const [feedback, keywords] = await Promise.all([
    prisma.feedback.findMany({ include: { post: true }, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.keyword.findMany(),
  ]);
  const liked = feedback.filter((row) => ["save", "contacted", "closed_won"].includes(row.action)).map((row) => row.post.text);
  const disliked = feedback.filter((row) => ["dismiss", "closed_lost"].includes(row.action)).map((row) => row.post.text);
  const suggestions = mineSuggestions(
    liked,
    disliked,
    keywords.filter((row) => row.type === "watch").map((row) => row.word),
    keywords.filter((row) => row.type === "forbidden").map((row) => row.word),
  );
  return json({ suggestions, liked: liked.length, disliked: disliked.length });
}

export function Highlight({ text, words }: { text: string; words: string[] }) {
  const cleaned = words.map((word) => word.trim()).filter(Boolean);
  if (!cleaned.length) return <>{text}</>;
  const escaped = cleaned.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "ig");
  const lookup = new Set(cleaned.map((word) => word.toLowerCase()));
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) =>
        lookup.has(part.toLowerCase()) ? (
          <mark key={`${part}-${index}`} className="rounded bg-amber/80 px-0.5 text-ink">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

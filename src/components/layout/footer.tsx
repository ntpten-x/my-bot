import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-line px-4 py-2 text-xs text-muted md:px-8">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
        <span>MY-BOT</span>
        <Link href="/guide">วิธีใช้</Link>
      </div>
    </footer>
  );
}

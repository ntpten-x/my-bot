import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="text-sm text-muted">MY-BOT</p>
      <h1 className="mt-2 text-3xl font-semibold">ไม่พบหน้านี้</h1>
      <p className="mt-3 text-muted">ลิงก์อาจเก่า หรือยังไม่ได้สร้างไว้</p>
      <Link href="/dashboard" className="mt-6 text-clay underline">
        กลับแดชบอร์ด
      </Link>
    </main>
  );
}

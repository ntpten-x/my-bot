import { authed } from "@/lib/guard";
import { DESKTOP_VERSION, desktopZip } from "@/lib/desktop-package";
import { selfOriginOf } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function desktopOrigin(request: Request) {
  const configured = String(process.env.DESKTOP_PUBLIC_ORIGIN || "").trim().replace(/\/$/, "");
  const requestOrigin = selfOriginOf(request.headers, request.url);
  if (!configured) return requestOrigin;
  if (configured !== requestOrigin) throw new Error("Desktop origin mismatch");
  return configured;
}

export async function GET(request: Request) {
  const { error } = await authed();
  if (error) return error;
  try {
    const zip = desktopZip(desktopOrigin(request));
    return new Response(new Uint8Array(zip), { headers: {
      "content-type": "application/zip", "content-disposition": `attachment; filename="mybot-desktop-${DESKTOP_VERSION}.zip"`,
      "cache-control": "no-store",
    } });
  } catch {
    return Response.json({ error: "ดาวน์โหลด MY-BOT Desktop จากเว็บ production ที่ใช้ HTTPS เท่านั้น" }, { status: 400 });
  }
}

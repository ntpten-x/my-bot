import { authed } from "@/lib/guard";
import { EXTENSION_VERSION, extensionZip } from "@/lib/extension-package";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const zip = extensionZip();
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="mybot-extension-${EXTENSION_VERSION}.zip"`,
      "cache-control": "no-store",
    },
  });
}
import { authed } from "@/lib/guard";
import { EXTENSION_VERSION, extensionZip } from "@/lib/extension-package";
import { selfOriginOf } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const zip = extensionZip(selfOriginOf(request.headers, request.url));
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="mybot-extension-${EXTENSION_VERSION}.zip"`,
      "cache-control": "no-store",
    },
  });
}

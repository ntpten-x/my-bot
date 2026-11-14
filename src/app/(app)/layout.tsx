import { headers } from "next/headers";
import { mfaRequiredForAccess } from "@/lib/session-policy";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Shell } from "@/components/shell";
import { ExtensionAutoConnect } from "@/components/extension-auto-connect";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Middleware only knows whether a cookie exists; never render owner pages on that alone.
  const session = await getSession();
  if (!session) redirect("/login");
  if (mfaRequiredForAccess() && !session.mfaEnabled && (await headers()).get("x-mybot-path") !== "/settings/security") redirect("/settings/security");
  return <Shell><ExtensionAutoConnect />{children}</Shell>;
}

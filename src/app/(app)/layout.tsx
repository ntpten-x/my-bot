import { Shell } from "@/components/shell";
import { ExtensionAutoConnect } from "@/components/extension-auto-connect";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Shell><ExtensionAutoConnect />{children}</Shell>;
}
